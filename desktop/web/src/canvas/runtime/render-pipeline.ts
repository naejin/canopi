import Konva from 'konva'
import { guides } from '../../state/canvas'
import { locale, theme } from '../../state/app'
import { plantColorByAttr, plantDisplayMode, selectedObjectIds, zoomLevel } from '../../state/canvas'
import { updatePlantsLOD, getPlantLOD, updatePlantLabelsForLocale } from '../plants'
import { updatePlantDisplay } from '../display-modes'
import { updateAnnotationsForZoom } from '../shapes'
import { updateGuideLines } from '../guides'
import { refreshGridColors } from '../grid'
import { refreshCanvasTheme } from '../theme-refresh'
import { updateHtmlRulers } from '../rulers'
import { refreshRulerColors } from '../rulers'
import type { RenderPipelineDeps } from './types'

export class CanvasRenderPipeline {
  private _overlayRafId: number | null = null
  private _lodTimeout: number | null = null

  constructor(private readonly _deps: RenderPipelineDeps) {}

  syncOverlayTransforms(): void {
    const htmlRulers = this._deps.getHtmlRulers()
    if (htmlRulers) updateHtmlRulers(htmlRulers, this._deps.stage)
    this._deps.getScaleBar()?.update(this._deps.stage)
  }

  scheduleOverlayRedraw(): void {
    if (this._overlayRafId !== null) return
    this._overlayRafId = requestAnimationFrame(() => {
      this._overlayRafId = null
      this.redrawOverlays()
    })
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

  scheduleLODUpdate(): void {
    if (this._lodTimeout !== null) clearTimeout(this._lodTimeout)
    this._lodTimeout = window.setTimeout(() => {
      this._lodTimeout = null
      this.reconcileZoomDependentState()
    }, 150)
  }

  refreshTheme(): void {
    const container = this._deps.stage.container()
    if (!container) return
    requestAnimationFrame(() => {
      void theme.value
      refreshGridColors(container)
      refreshRulerColors(container)
      const transformer = this._deps.stage.findOne('Transformer') as Konva.Transformer | undefined
      refreshCanvasTheme(container, this._deps.layers, transformer ?? null)
      this._deps.getScaleBar()?.update(this._deps.stage)
      this.redrawOverlays()
    })
  }

  refreshLocale(newLocale: string): void {
    const plantsLayer = this._deps.layers.get('plants')
    if (plantsLayer) {
      void updatePlantLabelsForLocale(plantsLayer, newLocale)
    }
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
      this._deps.getSpeciesCache(),
    )

    if (mode === 'color-by' && this._deps.getSpeciesCache().size === 0) {
      void this._deps.loadSpeciesCache(locale.value).then(() => {
        updatePlantDisplay(
          plantsLayer,
          mode,
          colorBy,
          this._deps.stage.scaleX(),
          this._deps.getSpeciesCache(),
        )
      })
    }
  }

  reconcileAfterMaterialization(): void {
    this.refreshPlantDisplay()
    this.reconcileZoomDependentState()

    const container = this._deps.stage.container()
    if (container) {
      const transformer = this._deps.stage.findOne('Transformer') as Konva.Transformer | undefined
      refreshCanvasTheme(container, this._deps.layers, transformer ?? null)
    }

    this.redrawOverlays()
  }

  dispose(): void {
    if (this._overlayRafId !== null) {
      cancelAnimationFrame(this._overlayRafId)
      this._overlayRafId = null
    }

    if (this._lodTimeout !== null) {
      clearTimeout(this._lodTimeout)
      this._lodTimeout = null
    }
  }

  private reconcileZoomDependentState(): void {
    const scale = zoomLevel.value
    const plantsLayer = this._deps.layers.get('plants')
    if (plantsLayer) {
      updatePlantsLOD(plantsLayer, getPlantLOD(scale), scale, selectedObjectIds.value)
    }

    const annotationsLayer = this._deps.layers.get('annotations')
    if (annotationsLayer) {
      updateAnnotationsForZoom(annotationsLayer, scale)
    }
  }
}
