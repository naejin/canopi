import type { Guide } from '../guides'
import {
  createHtmlRulers,
  refreshRulerColors,
  setHtmlOverlayVisibility,
  updateHtmlRulers,
  type HtmlRulers,
} from '../rulers'
import type { SceneViewportState } from './scene'
import { getCanvasColor } from '../theme-refresh'

const RULER_SIZE = 24
const GRID_Z_INDEX = 4
const NICE_DISTANCES = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
const MIN_SCREEN_GAP = 20
const MAJOR_STEP = 2

export interface SceneChromeSnapshot {
  viewport: SceneViewportState
  width: number
  height: number
  chromeVisible: boolean
  rulersVisible: boolean
  gridVisible: boolean
  guides: Guide[]
}

export class SceneChromeOverlay {
  private readonly _gridCanvas = document.createElement('canvas')
  private readonly _rulers: HtmlRulers
  private _snapshot: SceneChromeSnapshot | null = null
  private _onGuideCreate: ((axis: 'h' | 'v', worldPosition: number) => void) | null = null

  constructor(private readonly _container: HTMLElement) {
    refreshRulerColors(this._container)
    this._gridCanvas.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: ${GRID_Z_INDEX};
      pointer-events: none;
      display: block;
    `
    this._container.appendChild(this._gridCanvas)
    this._rulers = createHtmlRulers(this._container)
    this._rulers.onGuideCreate = (axis, screenPosition) => {
      const snapshot = this._snapshot
      if (!snapshot || !this._onGuideCreate) return
      const worldPosition = axis === 'h'
        ? (screenPosition - snapshot.viewport.y) / snapshot.viewport.scale
        : (screenPosition - snapshot.viewport.x) / snapshot.viewport.scale
      this._onGuideCreate(axis, worldPosition)
    }
  }

  setGuideCreate(callback: ((axis: 'h' | 'v', worldPosition: number) => void) | null): void {
    this._onGuideCreate = callback
  }

  refreshTheme(): void {
    refreshRulerColors(this._container)
    this.render()
  }

  update(snapshot: SceneChromeSnapshot): void {
    this._snapshot = snapshot
    this.render()
  }

  render(): void {
    const snapshot = this._snapshot
    if (!snapshot) return

    setHtmlOverlayVisibility(this._rulers, {
      chromeVisible: snapshot.chromeVisible,
      rulersVisible: snapshot.rulersVisible,
    })

    this._gridCanvas.style.display = snapshot.chromeVisible && (snapshot.gridVisible || snapshot.guides.length > 0)
      ? 'block'
      : 'none'

    if (!snapshot.chromeVisible) return

    updateHtmlRulers(this._rulers, {
      scaleX: () => snapshot.viewport.scale,
      scaleY: () => snapshot.viewport.scale,
      position: () => ({ x: snapshot.viewport.x, y: snapshot.viewport.y }),
      width: () => snapshot.width,
      height: () => snapshot.height,
    } as never)
    this._drawGrid(snapshot)
  }

  destroy(): void {
    this._rulers.destroy()
    this._gridCanvas.remove()
  }

  private _drawGrid(snapshot: SceneChromeSnapshot): void {
    const dpr = Math.max(window.devicePixelRatio || 1, 1)
    const width = Math.max(1, snapshot.width)
    const height = Math.max(1, snapshot.height)

    const pixelWidth = Math.round(width * dpr)
    const pixelHeight = Math.round(height * dpr)
    if (this._gridCanvas.width !== pixelWidth) this._gridCanvas.width = pixelWidth
    if (this._gridCanvas.height !== pixelHeight) this._gridCanvas.height = pixelHeight

    const ctx = this._gridCanvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    if (snapshot.gridVisible) {
      this._drawGridLines(ctx, snapshot)
    }

    if (snapshot.guides.length > 0) {
      this._drawGuideLines(ctx, snapshot)
    }
  }

  private _drawGridLines(ctx: CanvasRenderingContext2D, snapshot: SceneChromeSnapshot): void {
    const scale = snapshot.viewport.scale
    if (scale < 0.05) return

    const left = -snapshot.viewport.x / scale
    const top = -snapshot.viewport.y / scale
    const right = left + snapshot.width / scale
    const bottom = top + snapshot.height / scale

    let minorInterval = NICE_DISTANCES[NICE_DISTANCES.length - 1]!
    let minorIdx = NICE_DISTANCES.length - 1
    for (let index = 0; index < NICE_DISTANCES.length; index += 1) {
      if (NICE_DISTANCES[index]! * scale >= MIN_SCREEN_GAP) {
        minorInterval = NICE_DISTANCES[index]!
        minorIdx = index
        break
      }
    }

    const majorIdx = Math.min(minorIdx + MAJOR_STEP, NICE_DISTANCES.length - 1)
    const majorInterval = NICE_DISTANCES[majorIdx]!

    ctx.beginPath()
    ctx.strokeStyle = getComputedStyle(this._container).getPropertyValue('--canvas-grid').trim() || 'rgba(0,0,0,0.06)'
    ctx.lineWidth = 1

    for (let x = Math.floor(left / minorInterval) * minorInterval; x <= right; x += minorInterval) {
      const sx = snapshot.viewport.x + x * scale
      ctx.moveTo(Math.round(sx) + 0.5, 0)
      ctx.lineTo(Math.round(sx) + 0.5, snapshot.height)
    }
    for (let y = Math.floor(top / minorInterval) * minorInterval; y <= bottom; y += minorInterval) {
      const sy = snapshot.viewport.y + y * scale
      ctx.moveTo(0, Math.round(sy) + 0.5)
      ctx.lineTo(snapshot.width, Math.round(sy) + 0.5)
    }
    ctx.stroke()

    if (majorInterval <= minorInterval) return

    ctx.beginPath()
    ctx.strokeStyle = getComputedStyle(this._container).getPropertyValue('--canvas-grid-major').trim() || 'rgba(0,0,0,0.12)'
    ctx.lineWidth = 1

    for (let x = Math.floor(left / majorInterval) * majorInterval; x <= right; x += majorInterval) {
      const sx = snapshot.viewport.x + x * scale
      ctx.moveTo(Math.round(sx) + 0.5, 0)
      ctx.lineTo(Math.round(sx) + 0.5, snapshot.height)
    }
    for (let y = Math.floor(top / majorInterval) * majorInterval; y <= bottom; y += majorInterval) {
      const sy = snapshot.viewport.y + y * scale
      ctx.moveTo(0, Math.round(sy) + 0.5)
      ctx.lineTo(snapshot.width, Math.round(sy) + 0.5)
    }
    ctx.stroke()
  }

  private _drawGuideLines(ctx: CanvasRenderingContext2D, snapshot: SceneChromeSnapshot): void {
    ctx.save()
    ctx.strokeStyle = getCanvasColor('guide-line')
    ctx.lineWidth = 1
    ctx.setLineDash([6, 4])

    for (const guide of snapshot.guides) {
      if (guide.axis === 'v') {
        const x = snapshot.viewport.x + guide.position * snapshot.viewport.scale
        ctx.beginPath()
        ctx.moveTo(Math.round(x) + 0.5, RULER_SIZE)
        ctx.lineTo(Math.round(x) + 0.5, snapshot.height)
        ctx.stroke()
      } else {
        const y = snapshot.viewport.y + guide.position * snapshot.viewport.scale
        ctx.beginPath()
        ctx.moveTo(RULER_SIZE, Math.round(y) + 0.5)
        ctx.lineTo(snapshot.width, Math.round(y) + 0.5)
        ctx.stroke()
      }
    }

    ctx.restore()
  }
}
