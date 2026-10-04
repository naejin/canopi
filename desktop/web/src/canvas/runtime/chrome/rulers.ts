import type { ScreenPoint, ViewFrame, ViewTransform } from '../view/types'
import { NICE_DISTANCES } from '../../grid'
import { scaleReaches } from '../../projection'
import { CANVAS_CHROME_FONT_FAMILY } from '../../chrome-fonts'
import { getCanvasColor } from '../../theme-refresh'

/** Ruler band thickness in CSS px. */
const RULER_SIZE = 24
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
 * source takes ruler presses, and `pressRuler` finds the pressed ruler's overlay, whose press lands the guide.
 */
export interface RulerOverlay {
  update(snapshot: RulerOverlaySnapshot): void
  refreshTheme(): void
  destroy(): void
}

/**
 * One press on a ruler: its overlay's guide port for that press, through which the session (interaction-session.ts) lands
 * the guide at the drag's release, only while north is up. A press made before the rulers hide, go to overview or are
 * destroyed lands no guide.
 */
export interface RulerPress {
  /** The guide released at `at`, in CSS px of the camera's screen (the map host), unless the rulers hid since the press. */
  createGuideAt(at: ScreenPoint): void
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

const RULER_LABEL_FONT = `${CANVAS_RULER_LABEL_FONT_SIZE_PX}px ${CANVAS_CHROME_FONT_FAMILY}`

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

    // The rulers measure world axes along the screen's edges, so they show only while north is up (spec §4.6).
    const { mode, view } = snapshot.frame
    const shown = snapshot.chromeVisible && snapshot.rulersVisible && mode === 'site' && view.northUp
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

    if (mode === 'site' && view.northUp) {
      const origin = this._overlayOrigin()
      drawHorizontalRuler(this._horizontalCanvas, snapshot.frame, origin)
      drawVerticalRuler(this._verticalCanvas, snapshot.frame, origin)
    }
  }

  /** Repaints the latest frame in the canvas colours the theme switch just re-read, without waiting for the next frame. */
  refreshTheme(): void {
    if (this._snapshot) this.update(this._snapshot)
  }

  /**
   * A guide released at `at`, in CSS px of the camera's screen (the map host): nothing while the rulers are hidden (off,
   * in overview or turned from north), or inside the ruler's own gutter; otherwise a guide at that world coordinate of
   * the latest camera.
   */
  private _createGuideAt(axis: RulerAxis, at: ScreenPoint): void {
    if (this._destroyed) return
    const snapshot = this._snapshot
    if (!snapshot || !this._shown) return
    const origin = this._overlayOrigin()
    if (axis === 'h' && at.y <= origin.y + RULER_SIZE) return
    if (axis === 'v' && at.x <= origin.x + RULER_SIZE) return

    const ground = snapshot.frame.view.screenToWorld(at)
    this._options.onGuideCreate(axis, axis === 'h' ? ground.y : ground.x)
  }

  /** Today's drag start: the previous drag ends, and this one remembers the cursor to give back. */
  press(axis: RulerAxis): RulerPress | null {
    if (this._destroyed) return null
    this._activePress?.end()
    const hides = this._hides
    const previousCursor = this._container.style.cursor
    let active = true
    const press: RulerPress = {
      createGuideAt: (at) => {
        if (this._hides === hides) this._createGuideAt(axis, at)
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
      background: var(--canvas-ruler-bg);
      border-right: 1px solid var(--color-border);
      border-bottom: 1px solid var(--color-border);
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

interface RulerOverlayOrigin {
  readonly x: number
  readonly y: number
}

function drawHorizontalRuler(
  canvas: HTMLCanvasElement,
  frame: ViewFrame,
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

  const view = frame.view
  context.fillStyle = getCanvasColor('ruler-bg')
  context.fillRect(0, 0, cssWidth, cssHeight)
  context.strokeStyle = getCanvasColor('ruler-border')
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(0, cssHeight - 0.5)
  context.lineTo(cssWidth, cssHeight - 0.5)
  context.stroke()

  const { tickInterval, labelInterval } = calcTickIntervals(view.pixelsPerMetre)
  const screenOffsetX = origin.x + RULER_SIZE
  // The ticks meet the canvas on the ruler's inner edge: values and places are read on that row, where the grid lines cross it.
  const edgeRow = origin.y + RULER_SIZE
  const worldLeft = view.screenToWorld({ x: screenOffsetX, y: edgeRow }).x
  const worldRight = view.screenToWorld({ x: screenOffsetX + cssWidth, y: edgeRow }).x
  const startWorld = Math.floor(worldLeft / tickInterval) * tickInterval
  const labels = new RulerLabelSpacing()

  context.fillStyle = getCanvasColor('ruler-text')
  context.font = RULER_LABEL_FONT
  context.textAlign = 'center'
  context.textBaseline = 'bottom'
  context.strokeStyle = getCanvasColor('ruler-text')
  context.lineWidth = 1

  for (let world = startWorld; world <= worldRight; world += tickInterval) {
    const canvasX = rulerCrossing(view, 'h', world, edgeRow) - screenOffsetX
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

  const view = frame.view
  context.fillStyle = getCanvasColor('ruler-bg')
  context.fillRect(0, 0, cssWidth, cssHeight)
  context.strokeStyle = getCanvasColor('ruler-border')
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(cssWidth - 0.5, 0)
  context.lineTo(cssWidth - 0.5, cssHeight)
  context.stroke()

  const { tickInterval, labelInterval } = calcTickIntervals(view.pixelsPerMetre)
  const screenOffsetY = origin.y + RULER_SIZE
  const edgeColumn = origin.x + RULER_SIZE
  const worldTop = view.screenToWorld({ x: edgeColumn, y: screenOffsetY }).y
  const worldBottom = view.screenToWorld({ x: edgeColumn, y: screenOffsetY + cssHeight }).y
  const startWorld = Math.floor(worldTop / tickInterval) * tickInterval
  const labels = new RulerLabelSpacing()

  context.fillStyle = getCanvasColor('ruler-text')
  context.font = RULER_LABEL_FONT
  context.strokeStyle = getCanvasColor('ruler-text')
  context.lineWidth = 1

  for (let world = startWorld; world <= worldBottom; world += tickInterval) {
    const canvasY = rulerCrossing(view, 'v', world, edgeColumn) - screenOffsetY
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

/**
 * Where the grid line a tick labels crosses the ruler's inner edge, along the ruler: for the top ruler ('h') the world
 * column x = `world` on screen row `edge`, for the left ruler ('v') the world row y = `world` on screen column `edge`.
 * North-up allows a bearing of up to NORTH_UP_TOLERANCE_DEG, and the grid turns with it; a tick projected on world row
 * y = 0 (or column x = 0) would slide off its line by pixelsPerMetre × sin(bearing) × the edge's distance from the origin.
 */
function rulerCrossing(view: ViewTransform, axis: RulerAxis, world: number, edge: number): number {
  const from = view.worldToScreen(axis === 'h' ? { x: world, y: 0 } : { x: 0, y: world })
  const to = view.worldToScreen(axis === 'h' ? { x: world, y: 1 } : { x: 1, y: world })
  if (axis === 'h') return from.x + (to.x - from.x) * (edge - from.y) / (to.y - from.y)
  return from.y + (to.y - from.y) * (edge - from.x) / (to.x - from.x)
}

/** Admits centred labels along one axis only when they keep clear of the previous one. */
class RulerLabelSpacing {
  private _previousEnd = Number.NEGATIVE_INFINITY

  admit(context: CanvasRenderingContext2D, label: string, center: number): boolean {
    const half = context.measureText(label).width / 2
    if (center - half < this._previousEnd + RULER_LABEL_GAP_PX) return false
    this._previousEnd = center + half
    return true
  }
}

const RULER_DISTANCES = NICE_DISTANCES.filter((distance) => distance >= 0.1)

function calcTickIntervals(scale: number): { tickInterval: number; labelInterval: number } {
  let index = RULER_DISTANCES.length - 1
  for (let candidate = 0; candidate < RULER_DISTANCES.length; candidate += 1) {
    if (scaleReaches(RULER_DISTANCES[candidate]! * scale, 15)) {
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
