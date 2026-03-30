import Konva from 'konva'
import { guides } from '../../state/canvas'
import { locale, theme } from '../../state/app'
import { plantColorByAttr, plantDisplayMode, selectedObjectIds, zoomReference } from '../../state/canvas'
import {
  updatePlantCounterScale,
  updatePlantDensity,
  updatePlantLabelsForLocale,
  updatePlantLOD,
  updatePlantStacking,
  getPlantLOD,
} from '../plants'
import { updatePlantDisplay } from '../display-modes'
import { updateAnnotationsForZoom } from '../shapes'
import { updateGuideLines } from '../guides'
import { refreshGridColors } from '../grid'
import { refreshCanvasTheme } from '../theme-refresh'
import { updateHtmlRulers } from '../rulers'
import { refreshRulerColors } from '../rulers'
import type { ScreenGrid } from './screen-grid'
import type { RenderPipelineDeps } from './types'

export class CanvasRenderPipeline {
  constructor(private readonly _deps: RenderPipelineDeps) {}

  syncOverlayTransforms(): void {
    const htmlRulers = this._deps.getHtmlRulers()
    if (htmlRulers) updateHtmlRulers(htmlRulers, this._deps.stage)
    this._deps.getScaleBar()?.update(this._deps.stage)
  }

  redrawOverlays(): void {
    this.syncOverlayTransforms()
    this._deps.layers.get('base')?.batchDraw()
    this._deps.layers.get('ui')?.batchDraw()
    const annotationsLayer = this._deps.layers.get('annotations')
    if (annotationsLayer && guides.value.length > 0) {
      updateGuideLines(annotationsLayer, this._deps.stage)
    }
  }

  refreshTheme(): void {
    const container = this._deps.stage.container()
    if (!container) return
    void theme.value
    refreshGridColors(container)
    refreshRulerColors(container)
    const transformer = this._deps.stage.findOne('Transformer') as Konva.Transformer | undefined
    refreshCanvasTheme(container, this._deps.layers, transformer ?? null)
    this._deps.getScaleBar()?.update(this._deps.stage)
  }

  refreshLocale(newLocale: string): void {
    const plantsLayer = this._deps.layers.get('plants')
    if (plantsLayer) {
      void updatePlantLabelsForLocale(plantsLayer, newLocale)
    }
  }

  updatePlantCounterScale(scale: number): void {
    const plantsLayer = this._deps.layers.get('plants')
    if (!plantsLayer) return
    updatePlantCounterScale(plantsLayer, scale)
  }

  refreshPlantDisplay(): void {
    const plantsLayer = this._deps.layers.get('plants')
    if (!plantsLayer) return

    const mode = plantDisplayMode.value
    const colorBy = plantColorByAttr.value
    updatePlantDisplay(
      plantsLayer,
      mode,
      colorBy,
      this._deps.stage.scaleX(),
      zoomReference.value,
      this._deps.getSpeciesCache(),
    )

    if (mode === 'color-by' && this._deps.getSpeciesCache().size === 0) {
      void this._deps.loadSpeciesCache(locale.value).then(() => {
        updatePlantDisplay(
          plantsLayer,
          mode,
          colorBy,
          this._deps.stage.scaleX(),
          zoomReference.value,
          this._deps.getSpeciesCache(),
        )
      })
    }
  }

  updateLOD(scale: number): void {
    const plantsLayer = this._deps.layers.get('plants')
    if (!plantsLayer) return
    updatePlantLOD(plantsLayer, getPlantLOD(scale), selectedObjectIds.value)
  }

  updateAnnotations(scale: number): void {
    const annotationsLayer = this._deps.layers.get('annotations')
    if (!annotationsLayer) return
    updateAnnotationsForZoom(annotationsLayer, scale)
  }

  updateDeferredPlantPasses(
    plants: Konva.Group[],
    grid: ScreenGrid,
    scale: number,
  ): void {
    const plantsLayer = this._deps.layers.get('plants')
    if (!plantsLayer) return
    updatePlantDensity(plants, getPlantLOD(scale), selectedObjectIds.value, grid)
    updatePlantStacking(plants, grid)
    plantsLayer.batchDraw()
  }

  dispose(): void {}
}
