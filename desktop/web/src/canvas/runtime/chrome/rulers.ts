import type { ScreenPoint, ViewFrame } from '../view/types'
import { planarCameraOf } from '../view/view-transform'
import { NICE_DISTANCES } from '../../grid'
import { CANVAS_CHROME_FONT_FAMILY } from '../../chrome-fonts'
import { getCanvasColor } from '../../theme-refresh'

/** Ruler band thickness in CSS px. */
export const CANVAS_RULER_SIZE_PX = 24
const RULER_SIZE = CANVAS_RULER_SIZE_PX
/** Tick labels keep the 12 px type floor; they are digits and units, never CJK text. */
const CANVAS_RULER_LABEL_FONT_SIZE_PX = 12
/** Clear space between neighbouring tick labels; a label that would come closer is left out. */
const RULER_LABEL_GAP_PX = 6

type RulerAxis = 'h' | 'v'

interface RulerOverlaySnapshot {
  readonly frame: ViewFrame
  readonly chromeVisible: boolean
  readonly rulersVisible: boolean
}

export interface RulerOverlayOptions {
  readonly onGuideCreate: (axis: RulerAxis, worldPosition: number) => void
}

/**
 * Draws the rulers and creates the guides dragged out of them. The overlay listens to nothing (policy P6): the DOM input
 * source takes ruler presses, and `pressRuler` finds the pressed ruler's overlay. `createGuideAt` is today's gutter, origin
 * and visibility checks.
 */
export interface RulerOverlay {
  update(snapshot: RulerOverlaySnapshot): void
  refreshTheme(): void
  createGuideAt(axis: RulerAxis, at: ScreenPoint): void
  destroy(): void
}

/**
 * One press on a ruler: its overlay's guide port for that press, through which the session (interaction-session.ts) lands
 * the guide at the drag's release, only while north is up. A press made before the rulers hide, go to overview or are
 * destroyed lands no guide.
 */
export interface RulerPress {
  readonly axis: RulerAxis
  /** The guide released at `at`, in CSS px of the camera's screen (the map host), unless the rulers hid since the press. */
  createGuideAt(axis: RulerAxis, at: ScreenPoint): void
  /** The pointer moved during the drag: today's resize cursor on the overlay, until the drag ends. */
  drag(): void
  /** The drag is over: the overlay's cursor comes back. Idempotent; the overlay ends it itself when the rulers hide. */
  end(): void
}

/** Each ruler canvas's overlay, so a press found by the DOM input source reaches the overlay that drew that ruler. */
const OVERLAY_OF_RULER = new WeakMap<Element, HtmlRulerOverlay>()

/** A press on the ruler under `target` (the element the pointer went down on), or null when it is no live overlay's ruler. */
export function pressRuler(target: EventTarget | null): RulerPress | null {
  const element = target instanceof Element ? target : (target instanceof Node ? target.parentElement : null)
  const ruler = element?.closest('[data-canvas-ruler]') ?? null
  const overlay = ruler ? OVERLAY_OF_RULER.get(ruler) : undefined
  const axis = ruler?.getAttribute('data-canvas-ruler')
  if (!overlay || (axis !== 'h' && axis !== 'v')) return null
  return overlay.press(axis)
}

interface RulerPalette {
  readonly background: string
  readonly text: string
  readonly border: string
  readonly labelFont: string
}

const DEFAULT_PALETTE: RulerPalette = {
  background: getCanvasColor('ruler-bg'),
  text: getCanvasColor('ruler-text'),
  border: 'rgba(58, 46, 28, 0.14)',
  labelFont: `${CANVAS_RULER_LABEL_FONT_SIZE_PX}px ${CANVAS_CHROME_FONT_FAMILY}`,
}

export function createRulerOverlay(
  container: HTMLElement,
  options: RulerOverlayOptions,
): RulerOverlay {
  return new HtmlRulerOverlay(container, options)
}

class HtmlRulerOverlay implements RulerOverlay {
  private readonly _horizontalCanvas = document.createElement('canvas')
  private readonly _verticalCanvas = document.createElement('canvas')
  private readonly _corner = document.createElement('div')
  private _snapshot: RulerOverlaySnapshot | null = null
  private _palette = DEFAULT_PALETTE
  /** The press whose drag cursor shows; a new press, a hide or destroy ends it (today's active drag). */
  private _activePress: RulerPress | null = null
  /** Bumped each time the rulers hide and at destroy: a press made before lands no guide. */
  private _hides = 0
  private _shown = false
  private _destroyed = false

  constructor(
    private readonly _container: HTMLElement,
    private readonly _options: RulerOverlayOptions,
  ) {
    this._configureParts()
    try {
      this._container.appendChild(this._horizontalCanvas)
      this._container.appendChild(this._verticalCanvas)
      this._container.appendChild(this._corner)
      this.refreshTheme()
    } catch (error) {
      this._removeParts()
      this._destroyed = true
      throw error
    }
    OVERLAY_OF_RULER.set(this._horizontalCanvas, this)
    OVERLAY_OF_RULER.set(this._verticalCanvas, this)
  }

  update(snapshot: RulerOverlaySnapshot): void {
    if (this._destroyed) return
    this._snapshot = snapshot

    const siteMode = snapshot.frame.mode === 'site'
    const shown = snapshot.chromeVisible && snapshot.rulersVisible && siteMode
    const rulerDisplay = shown ? 'block' : 'none'
    this._horizontalCanvas.style.display = rulerDisplay
    this._verticalCanvas.style.display = rulerDisplay
    this._corner.style.display = rulerDisplay

    if (!shown) {
      if (this._shown) this._hides += 1
      this._activePress?.end()
    }
    this._shown = shown
    if (!snapshot.chromeVisible) return

    if (siteMode) {
      const origin = this._overlayOrigin()
      drawHorizontalRuler(this._horizontalCanvas, snapshot.frame, this._palette, origin)
      drawVerticalRuler(this._verticalCanvas, snapshot.frame, this._palette, origin)
    }
  }

  refreshTheme(): void {
    if (this._destroyed) return
    this._palette = readRulerPalette(this._container)
  }

  /**
   * A guide released at `at`, in CSS px of the camera's screen (the map host): nothing while the rulers are hidden or in
   * overview, or inside the ruler's own gutter; otherwise a guide at that world coordinate of the latest camera.
   */
  createGuideAt(axis: RulerAxis, at: ScreenPoint): void {
    if (this._destroyed) return
    const snapshot = this._snapshot
    if (!snapshot || !snapshot.chromeVisible || !snapshot.rulersVisible || snapshot.frame.mode !== 'site') return
    const origin = this._overlayOrigin()
    const screenX = at.x
    const screenY = at.y
    if (axis === 'h' && screenY <= origin.y + RULER_SIZE) return
    if (axis === 'v' && screenX <= origin.x + RULER_SIZE) return

    const viewport = planarCameraOf(snapshot.frame.view)
    const screenPosition = axis === 'h' ? screenY : screenX
    const viewportOffset = axis === 'h' ? viewport.y : viewport.x
    this._options.onGuideCreate(axis, (screenPosition - viewportOffset) / viewport.scale)
  }

  /** Today's drag start: the previous drag ends, and this one remembers the cursor to give back. */
  press(axis: RulerAxis): RulerPress | null {
    if (this._destroyed) return null
    this._activePress?.end()
    const hides = this._hides
    const previousCursor = this._container.style.cursor
    let active = true
    const press: RulerPress = {
      axis,
      createGuideAt: (guideAxis, at) => {
        if (this._hides === hides) this.createGuideAt(guideAxis, at)
      },
      drag: () => {
        if (active) this._container.style.cursor = axis === 'h' ? 's-resize' : 'e-resize'
      },
      end: () => {
        if (!active) return
        active = false
        this._container.style.cursor = previousCursor
        if (this._activePress === press) this._activePress = null
      },
    }
    this._activePress = press
    return press
  }

  destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    this._hides += 1
    this._activePress?.end()
    OVERLAY_OF_RULER.delete(this._horizontalCanvas)
    OVERLAY_OF_RULER.delete(this._verticalCanvas)
    this._removeParts()
    this._snapshot = null
  }

  private _configureParts(): void {
    this._horizontalCanvas.dataset.rulerOverlayPart = 'horizontal'
    // The DOM input source classifies a press here as a ruler target (spec §1.2), and pressRuler finds this overlay.
    this._horizontalCanvas.dataset.canvasRuler = 'h'
    this._horizontalCanvas.style.cssText = `
      position: absolute;
      top: 0;
      left: ${RULER_SIZE}px;
      width: calc(100% - ${RULER_SIZE}px);
      height: ${RULER_SIZE}px;
      z-index: 15;
      pointer-events: auto;
      cursor: s-resize;
      display: none;
    `

    this._verticalCanvas.dataset.rulerOverlayPart = 'vertical'
    this._verticalCanvas.dataset.canvasRuler = 'v'
    this._verticalCanvas.style.cssText = `
      position: absolute;
      top: ${RULER_SIZE}px;
      left: 0;
      width: ${RULER_SIZE}px;
      height: calc(100% - ${RULER_SIZE}px);
      z-index: 15;
      pointer-events: auto;
      cursor: e-resize;
      display: none;
    `

    this._corner.dataset.rulerOverlayPart = 'corner'
    this._corner.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: ${RULER_SIZE}px;
      height: ${RULER_SIZE}px;
      z-index: 17;
      pointer-events: none;
      background: var(--canvas-ruler-bg, ${DEFAULT_PALETTE.background});
      border-right: 1px solid var(--color-border, ${DEFAULT_PALETTE.border});
      border-bottom: 1px solid var(--color-border, ${DEFAULT_PALETTE.border});
      box-sizing: border-box;
      display: none;
    `
  }

  /**
   * Where the overlay sits inside the canvas, in camera screen pixels: the
   * workspace insets it below the floating title bar.
   */
  private _overlayOrigin(): RulerOverlayOrigin {
    return { x: this._container.offsetLeft, y: this._container.offsetTop }
  }

  private _removeParts(): void {
    this._horizontalCanvas.remove()
    this._verticalCanvas.remove()
    this._corner.remove()
  }
}

function readRulerPalette(container: HTMLElement): RulerPalette {
  const style = getComputedStyle(container)
  const text = style.getPropertyValue('--canvas-ruler-text').trim() || DEFAULT_PALETTE.text
  return {
    background: style.getPropertyValue('--canvas-ruler-bg').trim() || DEFAULT_PALETTE.background,
    text,
    border: style.getPropertyValue('--color-border').trim() || DEFAULT_PALETTE.border,
    labelFont: DEFAULT_PALETTE.labelFont,
  }
}

interface RulerOverlayOrigin {
  readonly x: number
  readonly y: number
}

function drawHorizontalRuler(
  canvas: HTMLCanvasElement,
  frame: ViewFrame,
  palette: RulerPalette,
  origin: RulerOverlayOrigin,
): void {
  const dpr = window.devicePixelRatio || 1
  const cssWidth = Math.max(0, frame.view.screen.width - origin.x - RULER_SIZE)
  const cssHeight = RULER_SIZE
  if (cssWidth <= 0) return

  const newWidth = Math.round(cssWidth * dpr)
  const newHeight = Math.round(cssHeight * dpr)
  if (canvas.width !== newWidth) canvas.width = newWidth
  if (canvas.height !== newHeight) canvas.height = newHeight

  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(dpr, 0, 0, dpr, 0, 0)

  const viewport = planarCameraOf(frame.view)
  const scale = viewport.scale
  context.fillStyle = palette.background
  context.fillRect(0, 0, cssWidth, cssHeight)
  context.strokeStyle = palette.border
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(0, cssHeight - 0.5)
  context.lineTo(cssWidth, cssHeight - 0.5)
  context.stroke()

  const { tickInterval, labelInterval } = calcTickIntervals(scale)
  const screenOffsetX = origin.x + RULER_SIZE
  const worldLeft = (screenOffsetX - viewport.x) / scale
  const worldRight = (screenOffsetX + cssWidth - viewport.x) / scale
  const startWorld = Math.floor(worldLeft / tickInterval) * tickInterval
  const labels = new RulerLabelSpacing()

  context.fillStyle = palette.text
  context.font = palette.labelFont
  context.textAlign = 'center'
  context.textBaseline = 'bottom'
  context.strokeStyle = palette.text
  context.lineWidth = 1

  for (let world = startWorld; world <= worldRight; world += tickInterval) {
    const canvasX = viewport.x + world * scale - screenOffsetX
    if (canvasX < 0 || canvasX > cssWidth) continue

    const isMajor = Math.abs(Math.round(world / labelInterval) * labelInterval - world) < 1e-9
    const tickHeight = isMajor ? 8 : 4
    context.beginPath()
    context.moveTo(canvasX, cssHeight - tickHeight)
    context.lineTo(canvasX, cssHeight)
    context.stroke()
    if (isMajor) {
      const label = formatDistance(world)
      if (labels.admit(context, label, canvasX)) context.fillText(label, canvasX, cssHeight - 9)
    }
  }
}

function drawVerticalRuler(
  canvas: HTMLCanvasElement,
  frame: ViewFrame,
  palette: RulerPalette,
  origin: RulerOverlayOrigin,
): void {
  const dpr = window.devicePixelRatio || 1
  const cssWidth = RULER_SIZE
  const cssHeight = Math.max(0, frame.view.screen.height - origin.y - RULER_SIZE)
  if (cssHeight <= 0) return

  const newWidth = Math.round(cssWidth * dpr)
  const newHeight = Math.round(cssHeight * dpr)
  if (canvas.width !== newWidth) canvas.width = newWidth
  if (canvas.height !== newHeight) canvas.height = newHeight

  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(dpr, 0, 0, dpr, 0, 0)

  const viewport = planarCameraOf(frame.view)
  const scale = viewport.scale
  context.fillStyle = palette.background
  context.fillRect(0, 0, cssWidth, cssHeight)
  context.strokeStyle = palette.border
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(cssWidth - 0.5, 0)
  context.lineTo(cssWidth - 0.5, cssHeight)
  context.stroke()

  const { tickInterval, labelInterval } = calcTickIntervals(scale)
  const screenOffsetY = origin.y + RULER_SIZE
  const worldTop = (screenOffsetY - viewport.y) / scale
  const worldBottom = (screenOffsetY + cssHeight - viewport.y) / scale
  const startWorld = Math.floor(worldTop / tickInterval) * tickInterval
  const labels = new RulerLabelSpacing()

  context.fillStyle = palette.text
  context.font = palette.labelFont
  context.strokeStyle = palette.text
  context.lineWidth = 1

  for (let world = startWorld; world <= worldBottom; world += tickInterval) {
    const canvasY = viewport.y + world * scale - screenOffsetY
    if (canvasY < 0 || canvasY > cssHeight) continue

    const isMajor = Math.abs(Math.round(world / labelInterval) * labelInterval - world) < 1e-9
    const tickWidth = isMajor ? 8 : 4
    context.beginPath()
    context.moveTo(cssWidth - tickWidth, canvasY)
    context.lineTo(cssWidth, canvasY)
    context.stroke()
    const label = isMajor ? formatDistance(world) : null
    if (label !== null && labels.admit(context, label, canvasY)) {
      context.save()
      context.translate(cssWidth - 15, canvasY)
      context.rotate(-Math.PI / 2)
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(label, 0, 0)
      context.restore()
    }
  }
}

/** Admits centred labels along one axis only when they keep clear of the previous one. */
class RulerLabelSpacing {
  private _previousEnd = Number.NEGATIVE_INFINITY

  admit(context: CanvasRenderingContext2D, label: string, center: number): boolean {
    const half = measureRulerLabel(context, label) / 2
    if (center - half < this._previousEnd + RULER_LABEL_GAP_PX) return false
    this._previousEnd = center + half
    return true
  }
}

function measureRulerLabel(context: CanvasRenderingContext2D, label: string): number {
  const measured = typeof context.measureText === 'function' ? context.measureText(label).width : NaN
  // Without metrics (no layout engine) assume a generous 0.6 em per character.
  return Number.isFinite(measured) && measured > 0 ? measured : label.length * CANVAS_RULER_LABEL_FONT_SIZE_PX * 0.6
}

const RULER_DISTANCES = NICE_DISTANCES.filter((distance) => distance >= 0.1)

function calcTickIntervals(scale: number): { tickInterval: number; labelInterval: number } {
  let index = RULER_DISTANCES.length - 1
  for (let candidate = 0; candidate < RULER_DISTANCES.length; candidate += 1) {
    if (RULER_DISTANCES[candidate]! * scale >= 15) {
      index = candidate
      break
    }
  }
  const tickInterval = RULER_DISTANCES[index]!
  let labelInterval = tickInterval
  if (index + 2 < RULER_DISTANCES.length) {
    labelInterval = RULER_DISTANCES[index + 2]!
  } else if (index + 1 < RULER_DISTANCES.length) {
    labelInterval = RULER_DISTANCES[index + 1]!
  }
  return { tickInterval, labelInterval }
}

function formatDistance(meters: number): string {
  if (Math.abs(meters) < 0.005) return '0'
  if (Math.abs(meters) >= 1000) return `${(meters / 1000).toFixed(0)}km`
  if (Math.abs(meters) < 1) return `${(meters * 100).toFixed(0)}cm`
  return `${meters % 1 === 0 ? meters.toFixed(0) : meters.toFixed(1)}m`
}
