import type { CameraViewportSnapshot } from './runtime/camera'
import {
  SCALE_BAR_CANVAS_WIDTH,
  SCALE_BAR_MARGIN_X,
  SCALE_BAR_MARGIN_Y,
  SCALE_BAR_RESERVED_BOTTOM_PX,
  getScaleBarDisplay,
} from './scale-bar'
import { CANVAS_RULER_SIZE_PX } from './canvas-notice-layout'
import { FONT_SANS_FALLBACK } from './canvas2d-utils'
import { NICE_DISTANCES } from './grid'

const RULER_SIZE = CANVAS_RULER_SIZE_PX

export type RulerAxis = 'h' | 'v'

export interface RulerOverlaySnapshot {
  readonly camera: CameraViewportSnapshot
  readonly chromeVisible: boolean
  readonly rulersVisible: boolean
}

export interface RulerOverlayOptions {
  readonly onGuideCreate: (axis: RulerAxis, worldPosition: number) => void
}

export interface RulerOverlay {
  update(snapshot: RulerOverlaySnapshot): void
  refreshTheme(): void
  destroy(): void
}

interface RulerPalette {
  readonly background: string
  readonly text: string
  readonly border: string
  readonly scaleBar: string
  readonly font10: string
  readonly font11: string
}

const DEFAULT_PALETTE: RulerPalette = {
  background: '#E8E3D9',
  text: '#6B5F4E',
  border: '#D4CFC5',
  scaleBar: '#6B5F4E',
  font10: `10px ${FONT_SANS_FALLBACK}`,
  font11: `11px ${FONT_SANS_FALLBACK}`,
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
  private readonly _scaleCanvas = document.createElement('canvas')
  private readonly _corner = document.createElement('div')
  private _snapshot: RulerOverlaySnapshot | null = null
  private _palette = DEFAULT_PALETTE
  private _cancelActiveDrag: (() => void) | null = null
  private _destroyed = false

  private readonly _onHorizontalMouseDown = (event: MouseEvent): void => {
    this._startDrag('h', event)
  }

  private readonly _onVerticalMouseDown = (event: MouseEvent): void => {
    this._startDrag('v', event)
  }

  constructor(
    private readonly _container: HTMLElement,
    private readonly _options: RulerOverlayOptions,
  ) {
    this._configureParts()
    try {
      this._container.appendChild(this._horizontalCanvas)
      this._container.appendChild(this._verticalCanvas)
      this._container.appendChild(this._scaleCanvas)
      this._container.appendChild(this._corner)
      this._horizontalCanvas.addEventListener('mousedown', this._onHorizontalMouseDown)
      this._verticalCanvas.addEventListener('mousedown', this._onVerticalMouseDown)
      this.refreshTheme()
    } catch (error) {
      this._removeRootListeners()
      this._removeParts()
      this._destroyed = true
      throw error
    }
  }

  update(snapshot: RulerOverlaySnapshot): void {
    if (this._destroyed) return
    this._snapshot = snapshot

    const rulerDisplay = snapshot.chromeVisible && snapshot.rulersVisible ? 'block' : 'none'
    this._horizontalCanvas.style.display = rulerDisplay
    this._verticalCanvas.style.display = rulerDisplay
    this._corner.style.display = rulerDisplay
    this._scaleCanvas.style.display = snapshot.chromeVisible ? 'block' : 'none'

    if (!snapshot.chromeVisible || !snapshot.rulersVisible) {
      this._cancelActiveDrag?.()
    }
    if (!snapshot.chromeVisible) return

    drawHorizontalRuler(this._horizontalCanvas, snapshot.camera, this._palette)
    drawVerticalRuler(this._verticalCanvas, snapshot.camera, this._palette)
    drawScaleBar(this._scaleCanvas, snapshot.camera, this._palette)
  }

  refreshTheme(): void {
    if (this._destroyed) return
    this._palette = readRulerPalette(this._container)
  }

  destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    this._cancelActiveDrag?.()
    this._removeRootListeners()
    this._removeParts()
    this._snapshot = null
  }

  private _configureParts(): void {
    this._horizontalCanvas.dataset.rulerOverlayPart = 'horizontal'
    this._horizontalCanvas.style.cssText = `
      position: absolute;
      top: 0;
      left: ${RULER_SIZE}px;
      width: calc(100% - ${RULER_SIZE}px);
      height: ${RULER_SIZE}px;
      z-index: 15;
      pointer-events: auto;
      cursor: s-resize;
      display: block;
    `

    this._verticalCanvas.dataset.rulerOverlayPart = 'vertical'
    this._verticalCanvas.style.cssText = `
      position: absolute;
      top: ${RULER_SIZE}px;
      left: 0;
      width: ${RULER_SIZE}px;
      height: calc(100% - ${RULER_SIZE}px);
      z-index: 15;
      pointer-events: auto;
      cursor: e-resize;
      display: block;
    `

    this._scaleCanvas.dataset.rulerOverlayPart = 'scale'
    this._scaleCanvas.style.cssText = `
      position: absolute;
      left: 0;
      bottom: 0;
      width: ${SCALE_BAR_CANVAS_WIDTH}px;
      height: ${SCALE_BAR_RESERVED_BOTTOM_PX}px;
      z-index: 18;
      pointer-events: none;
      display: block;
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
    `
  }

  private _startDrag(axis: RulerAxis, event: MouseEvent): void {
    if (this._destroyed) return
    event.preventDefault()
    this._cancelActiveDrag?.()

    const ownerDocument = this._container.ownerDocument
    const ownerWindow = ownerDocument.defaultView ?? window
    const previousCursor = this._container.style.cursor
    let active = true

    const cancel = (): void => {
      if (!active) return
      active = false
      ownerDocument.removeEventListener('mousemove', onMouseMove)
      ownerDocument.removeEventListener('mouseup', onMouseUp)
      ownerWindow.removeEventListener('blur', onBlur)
      this._container.style.cursor = previousCursor
      if (this._cancelActiveDrag === cancel) this._cancelActiveDrag = null
    }

    const onMouseMove = (): void => {
      if (!active) return
      this._container.style.cursor = axis === 'h' ? 's-resize' : 'e-resize'
    }

    const onMouseUp = (upEvent: MouseEvent): void => {
      cancel()
      if (this._destroyed) return

      const snapshot = this._snapshot
      if (!snapshot || !snapshot.chromeVisible || !snapshot.rulersVisible) return
      const rect = this._container.getBoundingClientRect()
      const screenX = upEvent.clientX - rect.left
      const screenY = upEvent.clientY - rect.top
      if (axis === 'h' && screenY <= RULER_SIZE) return
      if (axis === 'v' && screenX <= RULER_SIZE) return

      const viewport = snapshot.camera.viewport
      const screenPosition = axis === 'h' ? screenY : screenX
      const viewportOffset = axis === 'h' ? viewport.y : viewport.x
      this._options.onGuideCreate(axis, (screenPosition - viewportOffset) / viewport.scale)
    }

    const onBlur = (): void => {
      cancel()
    }

    this._cancelActiveDrag = cancel
    try {
      ownerDocument.addEventListener('mousemove', onMouseMove)
      ownerDocument.addEventListener('mouseup', onMouseUp)
      ownerWindow.addEventListener('blur', onBlur)
    } catch (error) {
      cancel()
      throw error
    }
  }

  private _removeRootListeners(): void {
    this._horizontalCanvas.removeEventListener('mousedown', this._onHorizontalMouseDown)
    this._verticalCanvas.removeEventListener('mousedown', this._onVerticalMouseDown)
  }

  private _removeParts(): void {
    this._horizontalCanvas.remove()
    this._verticalCanvas.remove()
    this._scaleCanvas.remove()
    this._corner.remove()
  }
}

function readRulerPalette(container: HTMLElement): RulerPalette {
  const style = getComputedStyle(container)
  const text = style.getPropertyValue('--canvas-ruler-text').trim() || '#64748b'
  const fontSans = style.getPropertyValue('--font-sans').trim() || FONT_SANS_FALLBACK
  return {
    background: style.getPropertyValue('--canvas-ruler-bg').trim() || '#fff',
    text,
    border: style.getPropertyValue('--color-border').trim() || '#e2e0dd',
    scaleBar: style.getPropertyValue('--color-text-muted').trim() || text,
    font10: `10px ${fontSans}`,
    font11: `11px ${fontSans}`,
  }
}

function drawHorizontalRuler(
  canvas: HTMLCanvasElement,
  camera: CameraViewportSnapshot,
  palette: RulerPalette,
): void {
  const dpr = window.devicePixelRatio || 1
  const cssWidth = Math.max(0, camera.screenSize.width - RULER_SIZE)
  const cssHeight = RULER_SIZE
  if (cssWidth <= 0) return

  const newWidth = Math.round(cssWidth * dpr)
  const newHeight = Math.round(cssHeight * dpr)
  if (canvas.width !== newWidth) canvas.width = newWidth
  if (canvas.height !== newHeight) canvas.height = newHeight

  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(dpr, 0, 0, dpr, 0, 0)

  const viewport = camera.viewport
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
  const screenOffsetX = RULER_SIZE
  const worldLeft = (screenOffsetX - viewport.x) / scale
  const worldRight = (screenOffsetX + cssWidth - viewport.x) / scale
  const startWorld = Math.floor(worldLeft / tickInterval) * tickInterval

  context.fillStyle = palette.text
  context.font = palette.font10
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
    if (isMajor) context.fillText(formatDistance(world), canvasX, cssHeight - 10)
  }
}

function drawVerticalRuler(
  canvas: HTMLCanvasElement,
  camera: CameraViewportSnapshot,
  palette: RulerPalette,
): void {
  const dpr = window.devicePixelRatio || 1
  const cssWidth = RULER_SIZE
  const cssHeight = Math.max(0, camera.screenSize.height - RULER_SIZE)
  if (cssHeight <= 0) return

  const newWidth = Math.round(cssWidth * dpr)
  const newHeight = Math.round(cssHeight * dpr)
  if (canvas.width !== newWidth) canvas.width = newWidth
  if (canvas.height !== newHeight) canvas.height = newHeight

  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(dpr, 0, 0, dpr, 0, 0)

  const viewport = camera.viewport
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
  const screenOffsetY = RULER_SIZE
  const worldTop = (screenOffsetY - viewport.y) / scale
  const worldBottom = (screenOffsetY + cssHeight - viewport.y) / scale
  const startWorld = Math.floor(worldTop / tickInterval) * tickInterval

  context.fillStyle = palette.text
  context.font = palette.font10
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
    if (isMajor) {
      context.save()
      context.translate(cssWidth - 10, canvasY)
      context.rotate(-Math.PI / 2)
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(formatDistance(world), 0, 0)
      context.restore()
    }
  }
}

function drawScaleBar(
  canvas: HTMLCanvasElement,
  camera: CameraViewportSnapshot,
  palette: RulerPalette,
): void {
  const dpr = window.devicePixelRatio || 1
  const cssWidth = SCALE_BAR_CANVAS_WIDTH
  const cssHeight = SCALE_BAR_RESERVED_BOTTOM_PX
  const newWidth = Math.round(cssWidth * dpr)
  const newHeight = Math.round(cssHeight * dpr)
  if (canvas.width !== newWidth) canvas.width = newWidth
  if (canvas.height !== newHeight) canvas.height = newHeight

  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, cssWidth, cssHeight)

  const { barScreenPx, label } = getScaleBarDisplay(camera.viewport.scale)
  const startX = SCALE_BAR_MARGIN_X
  const endX = startX + barScreenPx
  const lineY = cssHeight - SCALE_BAR_MARGIN_Y

  context.strokeStyle = palette.scaleBar
  context.fillStyle = palette.scaleBar
  context.lineWidth = 2
  context.lineCap = 'square'
  context.beginPath()
  context.moveTo(startX, lineY)
  context.lineTo(endX, lineY)
  context.stroke()
  context.beginPath()
  context.moveTo(startX, lineY - 4)
  context.lineTo(startX, lineY + 4)
  context.moveTo(endX, lineY - 4)
  context.lineTo(endX, lineY + 4)
  context.stroke()
  context.font = palette.font11
  context.textAlign = 'center'
  context.textBaseline = 'bottom'
  context.fillText(label, startX + barScreenPx / 2, lineY - 8)
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
