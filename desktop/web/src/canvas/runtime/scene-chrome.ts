import type { Guide } from '../guides'
import { NICE_DISTANCES, gridInterval } from '../grid'
import {
  createRulerOverlay,
  type RulerOverlay,
} from '../rulers'
import type { CameraViewportSnapshot } from './camera'
import { getCanvasColor } from '../theme-refresh'
import { CANVAS_RULER_SIZE_PX } from '../canvas-notice-layout'

const RULER_SIZE = CANVAS_RULER_SIZE_PX
const GRID_Z_INDEX = 4
const MAJOR_STEP = 2

export interface SceneChromeSnapshot {
  camera: CameraViewportSnapshot
  chromeVisible: boolean
  rulersVisible: boolean
  gridVisible: boolean
  guides: Guide[]
}

export class SceneChromeOverlay {
  private readonly _gridCanvas = document.createElement('canvas')
  private readonly _rulers: RulerOverlay
  private _snapshot: SceneChromeSnapshot | null = null
  private _gridColor = '#D4CFC5'
  private _gridMajorColor = '#B8A482'
  private _destroyed = false

  constructor(
    private readonly _container: HTMLElement,
    onGuideCreate: (axis: 'h' | 'v', worldPosition: number) => void,
  ) {
    this._gridCanvas.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: ${GRID_Z_INDEX};
      pointer-events: none;
      display: block;
    `
    this._gridCanvas.dataset.sceneChromePart = 'grid'

    let rulers: RulerOverlay | null = null
    try {
      this._container.appendChild(this._gridCanvas)
      rulers = createRulerOverlay(this._container, { onGuideCreate })
      this._refreshGridColors()
    } catch (error) {
      rulers?.destroy()
      this._gridCanvas.remove()
      throw error
    }
    this._rulers = rulers
  }

  refreshTheme(): void {
    if (this._destroyed) return
    this._rulers.refreshTheme()
    this._refreshGridColors()
    this.render()
  }

  update(snapshot: SceneChromeSnapshot): void {
    if (this._destroyed) return
    this._snapshot = snapshot
    this.render()
  }

  render(): void {
    const snapshot = this._snapshot
    if (!snapshot) return

    this._rulers.update({
      camera: snapshot.camera,
      chromeVisible: snapshot.chromeVisible,
      rulersVisible: snapshot.rulersVisible,
    })

    this._gridCanvas.style.display = snapshot.chromeVisible && (snapshot.gridVisible || snapshot.guides.length > 0)
      ? 'block'
      : 'none'

    if (!snapshot.chromeVisible) return

    this._drawGrid(snapshot)
  }

  destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    this._rulers.destroy()
    this._gridCanvas.remove()
    this._snapshot = null
  }

  private _drawGrid(snapshot: SceneChromeSnapshot): void {
    const dpr = Math.max(window.devicePixelRatio || 1, 1)
    const width = Math.max(1, snapshot.camera.screenSize.width)
    const height = Math.max(1, snapshot.camera.screenSize.height)

    const pixelWidth = Math.round(width * dpr)
    const pixelHeight = Math.round(height * dpr)
    if (this._gridCanvas.width !== pixelWidth) this._gridCanvas.width = pixelWidth
    if (this._gridCanvas.height !== pixelHeight) this._gridCanvas.height = pixelHeight

    const ctx = this._gridCanvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    if (snapshot.gridVisible) {
      this._drawGridLines(ctx, snapshot, width, height)
    }

    if (snapshot.guides.length > 0) {
      this._drawGuideLines(ctx, snapshot, width, height)
    }
  }

  private _drawGridLines(
    ctx: CanvasRenderingContext2D,
    snapshot: SceneChromeSnapshot,
    width: number,
    height: number,
  ): void {
    const viewport = snapshot.camera.viewport
    const scale = viewport.scale
    if (scale < 0.05) return

    const left = -viewport.x / scale
    const top = -viewport.y / scale
    const right = left + width / scale
    const bottom = top + height / scale

    const { interval: minorInterval, index: minorIdx } = gridInterval(scale)
    const majorIdx = Math.min(minorIdx + MAJOR_STEP, NICE_DISTANCES.length - 1)
    const majorInterval = NICE_DISTANCES[majorIdx]!

    ctx.beginPath()
    ctx.strokeStyle = this._gridColor
    ctx.lineWidth = 1

    for (let x = Math.floor(left / minorInterval) * minorInterval; x <= right; x += minorInterval) {
      const sx = viewport.x + x * scale
      ctx.moveTo(Math.round(sx) + 0.5, 0)
      ctx.lineTo(Math.round(sx) + 0.5, height)
    }
    for (let y = Math.floor(top / minorInterval) * minorInterval; y <= bottom; y += minorInterval) {
      const sy = viewport.y + y * scale
      ctx.moveTo(0, Math.round(sy) + 0.5)
      ctx.lineTo(width, Math.round(sy) + 0.5)
    }
    ctx.stroke()

    if (majorInterval <= minorInterval) return

    ctx.beginPath()
    ctx.strokeStyle = this._gridMajorColor
    ctx.lineWidth = 1

    for (let x = Math.floor(left / majorInterval) * majorInterval; x <= right; x += majorInterval) {
      const sx = viewport.x + x * scale
      ctx.moveTo(Math.round(sx) + 0.5, 0)
      ctx.lineTo(Math.round(sx) + 0.5, height)
    }
    for (let y = Math.floor(top / majorInterval) * majorInterval; y <= bottom; y += majorInterval) {
      const sy = viewport.y + y * scale
      ctx.moveTo(0, Math.round(sy) + 0.5)
      ctx.lineTo(width, Math.round(sy) + 0.5)
    }
    ctx.stroke()
  }

  private _drawGuideLines(
    ctx: CanvasRenderingContext2D,
    snapshot: SceneChromeSnapshot,
    width: number,
    height: number,
  ): void {
    const rulerInset = snapshot.rulersVisible ? RULER_SIZE : 0
    const viewport = snapshot.camera.viewport

    ctx.save()
    ctx.strokeStyle = getCanvasColor('guide-line')
    ctx.lineWidth = 1
    ctx.setLineDash([6, 4])

    for (const guide of snapshot.guides) {
      if (guide.axis === 'v') {
        const x = viewport.x + guide.position * viewport.scale
        ctx.beginPath()
        ctx.moveTo(Math.round(x) + 0.5, rulerInset)
        ctx.lineTo(Math.round(x) + 0.5, height)
        ctx.stroke()
      } else {
        const y = viewport.y + guide.position * viewport.scale
        ctx.beginPath()
        ctx.moveTo(rulerInset, Math.round(y) + 0.5)
        ctx.lineTo(width, Math.round(y) + 0.5)
        ctx.stroke()
      }
    }

    ctx.restore()
  }

  private _refreshGridColors(): void {
    const style = getComputedStyle(this._container)
    this._gridColor = style.getPropertyValue('--canvas-grid').trim() || '#D4CFC5'
    this._gridMajorColor = style.getPropertyValue('--canvas-grid-major').trim() || '#B8A482'
  }
}
