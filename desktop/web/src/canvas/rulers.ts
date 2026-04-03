import { gridSize } from '../state/canvas'
import {
  SCALE_BAR_CANVAS_WIDTH,
  SCALE_BAR_MARGIN_X,
  SCALE_BAR_MARGIN_Y,
  SCALE_BAR_RESERVED_BOTTOM_PX,
  getScaleBarDisplay,
} from './scale-bar'

const RULER_SIZE = 24 // pixels — thickness of horizontal and vertical rulers

/** Minimal stage view contract — decoupled from any renderer library. */
export interface StageView {
  scaleX(): number
  scaleY(): number
  position(): { x: number; y: number }
}

// ---------------------------------------------------------------------------
// Ruler state returned from createHtmlRulers()
// ---------------------------------------------------------------------------

export interface HtmlRulers {
  hCanvas: HTMLCanvasElement
  vCanvas: HTMLCanvasElement
  scaleCanvas: HTMLCanvasElement
  corner: HTMLDivElement
  destroy(): void
  /** Set a callback to be invoked when the user drags from a ruler to create a guide. */
  onGuideCreate: ((axis: 'h' | 'v', worldPosition: number) => void) | null
}

// ---------------------------------------------------------------------------
// Cached ruler colors — refreshed on theme change, not every frame
// ---------------------------------------------------------------------------

let _rulerBg = '#E8E3D9'
let _rulerText = 'rgba(60, 45, 30, 0.4)'
let _rulerBorder = 'rgba(60, 45, 30, 0.12)'
let _scaleBarColor = 'rgba(60, 45, 30, 0.4)'

/** Call once after init and on every theme change. */
export function refreshRulerColors(container: HTMLElement): void {
  const cs = getComputedStyle(container)
  _rulerBg = cs.getPropertyValue('--canvas-ruler-bg').trim() || '#fff'
  _rulerText = cs.getPropertyValue('--canvas-ruler-text').trim() || '#64748b'
  _rulerBorder = cs.getPropertyValue('--color-border').trim() || '#e2e0dd'
  _scaleBarColor = cs.getPropertyValue('--color-text-muted').trim() || _rulerText
}

// ---------------------------------------------------------------------------
// Create two <canvas> elements and a corner <div> inside containerDiv.
// These are positioned absolutely over the canvas stage and are always in
// screen space — no renderer layer transforms involved.
// ---------------------------------------------------------------------------

export function createHtmlRulers(containerDiv: HTMLElement): HtmlRulers {
  // Horizontal ruler — full width minus corner, RULER_SIZE tall, at top
  // IMPORTANT: <canvas> elements need explicit width/height via CSS —
  // left+right stretching alone doesn't set the layout size reliably.
  const hCanvas = document.createElement('canvas')
  hCanvas.style.cssText = `
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

  // Vertical ruler — full height minus corner, RULER_SIZE wide, at left
  const vCanvas = document.createElement('canvas')
  vCanvas.style.cssText = `
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

  const scaleCanvas = document.createElement('canvas')
  scaleCanvas.style.cssText = `
    position: absolute;
    left: 0;
    bottom: 0;
    width: ${SCALE_BAR_CANVAS_WIDTH}px;
    height: ${SCALE_BAR_RESERVED_BOTTOM_PX}px;
    z-index: 18;
    pointer-events: none;
    display: block;
  `

  // Corner square — opaque box that covers the ruler intersection at top-left.
  // Must sit above both ruler canvases (z-index 17 > 15).
  // Uses CSS variables directly so it updates on theme change without rebuild.
  const corner = document.createElement('div')
  corner.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: ${RULER_SIZE}px;
    height: ${RULER_SIZE}px;
    z-index: 17;
    pointer-events: none;
    background: var(--canvas-ruler-bg, ${_rulerBg});
    border-right: 1px solid var(--color-border, ${_rulerBorder});
    border-bottom: 1px solid var(--color-border, ${_rulerBorder});
    box-sizing: border-box;
  `

  containerDiv.appendChild(hCanvas)
  containerDiv.appendChild(vCanvas)
  containerDiv.appendChild(scaleCanvas)
  containerDiv.appendChild(corner)

  const result: HtmlRulers = {
    hCanvas,
    vCanvas,
    scaleCanvas,
    corner,
    destroy,
    onGuideCreate: null,
  }

  // Drag-from-ruler to create a guide line.
  // Horizontal ruler drag → horizontal guide (axis='h')
  // Vertical ruler drag → vertical guide (axis='v')
  function setupRulerDrag(
    canvas: HTMLCanvasElement,
    axis: 'h' | 'v',
  ): void {
    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault()
      // We don't create the guide on mousedown — we wait for mouseup on the
      // main canvas area. This means the user "drags" from the ruler.
      // Use the mouseup position to determine the world coordinate.
      const onMouseUp = (upEvent: MouseEvent) => {
        document.removeEventListener('mouseup', onMouseUp)
        document.removeEventListener('mousemove', onMouseMove)
        containerDiv.style.cursor = ''

        // Only create if the mouse ended outside the ruler area
        const rect = containerDiv.getBoundingClientRect()
        const mx = upEvent.clientX - rect.left
        const my = upEvent.clientY - rect.top

        if (axis === 'h' && my <= RULER_SIZE) return  // Dropped back on ruler
        if (axis === 'v' && mx <= RULER_SIZE) return

        if (result.onGuideCreate) {
          // Convert screen position to world coordinate
          // The engine will set this callback with proper stage reference
          if (axis === 'h') {
            result.onGuideCreate('h', my)
          } else {
            result.onGuideCreate('v', mx)
          }
        }
      }
      const onMouseMove = (_moveEvent: MouseEvent) => {
        containerDiv.style.cursor = axis === 'h' ? 's-resize' : 'e-resize'
      }
      document.addEventListener('mouseup', onMouseUp)
      document.addEventListener('mousemove', onMouseMove)
    })
  }

  setupRulerDrag(hCanvas, 'h')
  setupRulerDrag(vCanvas, 'v')

  function destroy(): void {
    hCanvas.remove()
    vCanvas.remove()
    scaleCanvas.remove()
    corner.remove()
  }

  return result
}

export function setHtmlOverlayVisibility(
  rulers: HtmlRulers,
  options: { chromeVisible: boolean; rulersVisible: boolean },
): void {
  const rulerDisplay = options.chromeVisible && options.rulersVisible ? 'block' : 'none'
  const scaleDisplay = options.chromeVisible ? 'block' : 'none'

  rulers.hCanvas.style.display = rulerDisplay
  rulers.vCanvas.style.display = rulerDisplay
  rulers.corner.style.display = rulerDisplay
  rulers.scaleCanvas.style.display = scaleDisplay
}

// ---------------------------------------------------------------------------
// Redraw both ruler canvases based on current stage state.
// Call this after every zoom, pan, resize, and theme change.
// ---------------------------------------------------------------------------

export function updateHtmlRulers(rulers: HtmlRulers, stage: StageView): void {
  _drawHorizontalRuler(rulers.hCanvas, stage)
  _drawVerticalRuler(rulers.vCanvas, stage)
  _drawScaleBar(rulers.scaleCanvas, stage)
}

// ---------------------------------------------------------------------------
// Internal drawing functions
// ---------------------------------------------------------------------------

function _drawHorizontalRuler(canvas: HTMLCanvasElement, stage: StageView): void {
  // Match physical canvas size to CSS layout size (account for device pixel ratio)
  const dpr = window.devicePixelRatio || 1
  const cssWidth = canvas.offsetWidth
  const cssHeight = RULER_SIZE

  if (cssWidth <= 0) return

  const newW = cssWidth * dpr
  const newH = cssHeight * dpr
  if (canvas.width !== newW) canvas.width = newW
  if (canvas.height !== newH) canvas.height = newH

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const scale = stage.scaleX()
  const stagePos = stage.position()

  // Background
  ctx.fillStyle = _rulerBg
  ctx.fillRect(0, 0, cssWidth, cssHeight)

  // Bottom border
  ctx.strokeStyle = _rulerBorder
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, cssHeight - 0.5)
  ctx.lineTo(cssWidth, cssHeight - 0.5)
  ctx.stroke()

  const size = gridSize.value
  const { tickInterval, labelInterval } = _calcTickIntervals(scale, size)

  // World coordinate of the left edge of the visible area visible in this canvas.
  // The hCanvas starts at screen x = RULER_SIZE (CSS left offset), so the
  // leftmost world coord is (RULER_SIZE - stagePos.x) / scale.
  const screenOffsetX = RULER_SIZE  // pixels the canvas is shifted right in the container
  const worldLeft = (screenOffsetX - stagePos.x) / scale
  const worldRight = (screenOffsetX + cssWidth - stagePos.x) / scale
  const startWorld = Math.floor(worldLeft / tickInterval) * tickInterval

  ctx.fillStyle = _rulerText
  ctx.font = `10px Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.strokeStyle = _rulerText
  ctx.lineWidth = 1

  for (let w = startWorld; w <= worldRight; w += tickInterval) {
    // Screen x within the full container, then offset into this canvas's local coords
    const containerScreenX = stagePos.x + w * scale
    const canvasX = containerScreenX - screenOffsetX

    if (canvasX < 0 || canvasX > cssWidth) continue

    const isMajor = Math.abs(Math.round(w / labelInterval) * labelInterval - w) < 1e-9
    const tickH = isMajor ? 8 : 4

    ctx.beginPath()
    ctx.moveTo(canvasX, cssHeight - tickH)
    ctx.lineTo(canvasX, cssHeight)
    ctx.stroke()

    if (isMajor) {
      ctx.fillText(_formatDistance(w), canvasX, cssHeight - 10)
    }
  }
}

function _drawVerticalRuler(canvas: HTMLCanvasElement, stage: StageView): void {
  const dpr = window.devicePixelRatio || 1
  const cssWidth = RULER_SIZE
  const cssHeight = canvas.offsetHeight

  if (cssHeight <= 0) return

  const newW = cssWidth * dpr
  const newH = cssHeight * dpr
  if (canvas.width !== newW) canvas.width = newW
  if (canvas.height !== newH) canvas.height = newH

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const scale = stage.scaleY()
  const stagePos = stage.position()

  // Background
  ctx.fillStyle = _rulerBg
  ctx.fillRect(0, 0, cssWidth, cssHeight)

  // Right border
  ctx.strokeStyle = _rulerBorder
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cssWidth - 0.5, 0)
  ctx.lineTo(cssWidth - 0.5, cssHeight)
  ctx.stroke()

  const size = gridSize.value
  const { tickInterval, labelInterval } = _calcTickIntervals(scale, size)

  // The vCanvas starts at screen y = RULER_SIZE (CSS top offset)
  const screenOffsetY = RULER_SIZE
  const worldTop = (screenOffsetY - stagePos.y) / scale
  const worldBottom = (screenOffsetY + cssHeight - stagePos.y) / scale
  const startWorld = Math.floor(worldTop / tickInterval) * tickInterval

  ctx.fillStyle = _rulerText
  ctx.font = `10px Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
  ctx.strokeStyle = _rulerText
  ctx.lineWidth = 1

  for (let w = startWorld; w <= worldBottom; w += tickInterval) {
    const containerScreenY = stagePos.y + w * scale
    const canvasY = containerScreenY - screenOffsetY

    if (canvasY < 0 || canvasY > cssHeight) continue

    const isMajor = Math.abs(Math.round(w / labelInterval) * labelInterval - w) < 1e-9
    const tickW = isMajor ? 8 : 4

    ctx.beginPath()
    ctx.moveTo(cssWidth - tickW, canvasY)
    ctx.lineTo(cssWidth, canvasY)
    ctx.stroke()

    if (isMajor) {
      const label = _formatDistance(w)
      ctx.save()
      ctx.translate(cssWidth - 10, canvasY)
      ctx.rotate(-Math.PI / 2)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, 0, 0)
      ctx.restore()
    }
  }
}

function _drawScaleBar(canvas: HTMLCanvasElement, stage: StageView): void {
  const dpr = window.devicePixelRatio || 1
  const cssWidth = canvas.offsetWidth
  const cssHeight = canvas.offsetHeight

  if (cssWidth <= 0 || cssHeight <= 0) return

  const newW = cssWidth * dpr
  const newH = cssHeight * dpr
  if (canvas.width !== newW) canvas.width = newW
  if (canvas.height !== newH) canvas.height = newH

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssWidth, cssHeight)

  const { barScreenPx, label } = getScaleBarDisplay(stage.scaleX())
  const startX = SCALE_BAR_MARGIN_X
  const endX = startX + barScreenPx
  const lineY = cssHeight - SCALE_BAR_MARGIN_Y

  const color = _scaleBarColor

  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2
  ctx.lineCap = 'square'

  ctx.beginPath()
  ctx.moveTo(startX, lineY)
  ctx.lineTo(endX, lineY)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(startX, lineY - 4)
  ctx.lineTo(startX, lineY + 4)
  ctx.moveTo(endX, lineY - 4)
  ctx.lineTo(endX, lineY + 4)
  ctx.stroke()

  ctx.font = `11px Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(label, startX + barScreenPx / 2, lineY - 8)
}

// ---------------------------------------------------------------------------
// Tick interval calculation
// Aim for ~60px between label ticks and ~15px between minor ticks
// ---------------------------------------------------------------------------

const RULER_NICE_DISTANCES = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]

function _calcTickIntervals(
  scale: number,
  _gridSizeMeters: number,
): { tickInterval: number; labelInterval: number } {
  let tickInterval = RULER_NICE_DISTANCES[0]!
  for (const d of RULER_NICE_DISTANCES) {
    if (d * scale >= 15) {
      tickInterval = d
      break
    }
  }

  let labelInterval = tickInterval
  const idx = RULER_NICE_DISTANCES.indexOf(tickInterval)
  if (idx >= 0 && idx + 2 < RULER_NICE_DISTANCES.length) {
    labelInterval = RULER_NICE_DISTANCES[idx + 2]!
  }

  return { tickInterval, labelInterval }
}

function _formatDistance(meters: number): string {
  if (Math.abs(meters) < 0.005) return '0'
  if (Math.abs(meters) >= 1000) return `${(meters / 1000).toFixed(0)}km`
  if (Math.abs(meters) < 1) return `${(meters * 100).toFixed(0)}cm`
  return `${meters % 1 === 0 ? meters.toFixed(0) : meters.toFixed(1)}m`
}
