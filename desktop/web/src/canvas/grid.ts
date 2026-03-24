import Konva from 'konva'

// ---------------------------------------------------------------------------
// Grid overlay — single Konva.Shape with a custom sceneFunc.
// Drawing all lines via canvas 2D path in one call is orders of magnitude
// faster than individual Konva.Line nodes at high zoom-out levels.
// ---------------------------------------------------------------------------

// Cached CSS token colors — updated by refreshGridColors() on theme change.
let _minorColor = 'rgba(0,0,0,0.06)'
let _majorColor = 'rgba(0,0,0,0.12)'

/** Call once after init and on every theme change to refresh grid colors. */
export function refreshGridColors(container: HTMLElement): void {
  const cs = getComputedStyle(container)
  _minorColor = cs.getPropertyValue('--canvas-grid').trim() || 'rgba(0,0,0,0.06)'
  _majorColor = cs.getPropertyValue('--canvas-grid-major').trim() || 'rgba(0,0,0,0.12)'
}

// Nice distance ladder — used to pick a grid interval that keeps lines
// ~20-40 screen pixels apart at any zoom level.
const NICE_DISTANCES = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
const MIN_SCREEN_GAP = 20  // minimum pixels between minor gridlines
const MAJOR_STEP = 2       // skip 2 steps in NICE_DISTANCES for major lines

export function createGridShape(stage: Konva.Stage): Konva.Shape {
  refreshGridColors(stage.container())

  return new Konva.Shape({
    sceneFunc: (ctx, shape) => {
      const scale = stage.scaleX()

      // At very small zoom the grid is invisible noise
      if (scale < 0.05) return

      const stagePos = stage.position()
      const width = stage.width()
      const height = stage.height()

      // Viewport in world coordinates
      const left = -stagePos.x / scale
      const top = -stagePos.y / scale
      const right = left + width / scale
      const bottom = top + height / scale

      // Pick the smallest nice distance whose screen gap >= MIN_SCREEN_GAP
      let minorInterval = NICE_DISTANCES[NICE_DISTANCES.length - 1]!
      let minorIdx = NICE_DISTANCES.length - 1
      for (let i = 0; i < NICE_DISTANCES.length; i++) {
        if (NICE_DISTANCES[i]! * scale >= MIN_SCREEN_GAP) {
          minorInterval = NICE_DISTANCES[i]!
          minorIdx = i
          break
        }
      }

      // Major lines: 2 steps up in the ladder (e.g. 1m minor → 5m major)
      const majorIdx = Math.min(minorIdx + MAJOR_STEP, NICE_DISTANCES.length - 1)
      const majorInterval = NICE_DISTANCES[majorIdx]!

      // Scale-independent line width: always ~0.5px on screen
      const lw = 0.5 / scale

      // ---- Minor grid lines ------------------------------------------------
      const minorStartX = Math.floor(left / minorInterval) * minorInterval
      const minorStartY = Math.floor(top / minorInterval) * minorInterval

      ctx.beginPath()
      for (let x = minorStartX; x <= right; x += minorInterval) {
        ctx.moveTo(x, top)
        ctx.lineTo(x, bottom)
      }
      for (let y = minorStartY; y <= bottom; y += minorInterval) {
        ctx.moveTo(left, y)
        ctx.lineTo(right, y)
      }
      ctx.strokeStyle = _minorColor
      ctx.lineWidth = lw
      ctx.stroke()

      // ---- Major grid lines — thicker, only if they differ from minor ------
      if (majorInterval > minorInterval) {
        const majorStartX = Math.floor(left / majorInterval) * majorInterval
        const majorStartY = Math.floor(top / majorInterval) * majorInterval

        ctx.beginPath()
        for (let x = majorStartX; x <= right; x += majorInterval) {
          ctx.moveTo(x, top)
          ctx.lineTo(x, bottom)
        }
        for (let y = majorStartY; y <= bottom; y += majorInterval) {
          ctx.moveTo(left, y)
          ctx.lineTo(right, y)
        }
        ctx.strokeStyle = _majorColor
        ctx.lineWidth = lw * 1.5
        ctx.stroke()
      }

      ctx.fillStrokeShape(shape)
    },
    listening: false,
    perfectDrawEnabled: false,
  })
}

// ---------------------------------------------------------------------------
// Snap-to-grid — pure arithmetic, no Konva API calls
// ---------------------------------------------------------------------------

export function snapToGrid(
  x: number,
  y: number,
  size: number,
): { x: number; y: number } {
  return {
    x: Math.round(x / size) * size,
    y: Math.round(y / size) * size,
  }
}
