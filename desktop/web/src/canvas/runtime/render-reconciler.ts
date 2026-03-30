import Konva from 'konva'
import { zoomLevel } from '../../state/canvas'
import type { RenderPass } from './render-passes'
import { ScreenGrid, type ScreenPlant } from './screen-grid'
import type { CanvasRenderPipeline } from './render-pipeline'

interface RenderReconcilerDeps {
  stage: Konva.Stage
  pipeline: CanvasRenderPipeline
  getVisiblePlantsForDeferredPasses: () => Konva.Group[]
}

export class RenderReconciler {
  private readonly _dirty = new Set<RenderPass>()
  private readonly _deferredGrid = new ScreenGrid(40)
  private _rafId: number | null = null
  private _deferredTimeout: number | null = null

  constructor(private readonly _deps: RenderReconcilerDeps) {}

  invalidate(...passes: RenderPass[]): void {
    for (const pass of passes) {
      this._dirty.add(pass)
    }
    this._scheduleFlush()
  }

  applyStageTransform(
    scale: number,
    position: { x: number; y: number },
    options: { invalidateDeferred?: boolean } = {},
  ): void {
    this._deps.stage.setAttrs({
      scaleX: scale,
      scaleY: scale,
      x: position.x,
      y: position.y,
    })
    zoomLevel.value = scale

    this.invalidate(
      'counter-scale',
      'plant-display',
      'lod',
      'annotations',
      'overlays',
    )

    if (options.invalidateDeferred) {
      this.invalidate('density', 'stacking')
    }
  }

  dispose(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
    if (this._deferredTimeout !== null) {
      clearTimeout(this._deferredTimeout)
      this._deferredTimeout = null
    }
  }

  private _scheduleFlush(): void {
    if (this._rafId !== null) return
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null
      this._flush()
    })
  }

  private _flush(): void {
    const scale = this._deps.stage.scaleX()

    if (this._dirty.has('counter-scale')) {
      this._deps.pipeline.updatePlantCounterScale(scale)
      this._dirty.delete('counter-scale')
    }

    if (this._dirty.has('plant-display')) {
      this._deps.pipeline.refreshPlantDisplay()
      this._dirty.delete('plant-display')
    }

    if (this._dirty.has('lod')) {
      this._deps.pipeline.updateLOD(scale)
      this._dirty.delete('lod')
    }

    if (this._dirty.has('annotations')) {
      this._deps.pipeline.updateAnnotations(scale)
      this._dirty.delete('annotations')
    }

    if (this._dirty.has('theme')) {
      this._deps.pipeline.refreshTheme()
      this._dirty.delete('theme')
    }

    if (this._dirty.has('overlays')) {
      this._deps.pipeline.redrawOverlays()
      this._dirty.delete('overlays')
    }

    if (this._dirty.has('density') || this._dirty.has('stacking')) {
      this._dirty.delete('density')
      this._dirty.delete('stacking')
      this._scheduleDeferredPlantPasses(scale)
    }
  }

  private _scheduleDeferredPlantPasses(scale: number): void {
    if (this._deferredTimeout !== null) {
      clearTimeout(this._deferredTimeout)
    }

    this._deferredTimeout = window.setTimeout(() => {
      this._deferredTimeout = null
      const plants = this._deps.getVisiblePlantsForDeferredPasses().map((group) => {
        const abs = group.getAbsolutePosition()
        return {
          group,
          sx: abs.x,
          sy: abs.y,
        } satisfies ScreenPlant
      })
      this._deferredGrid.rebuild(plants)
      this._deps.pipeline.updateDeferredPlantPasses(plants.map((plant) => plant.group), this._deferredGrid, scale)
    }, 150)
  }
}
