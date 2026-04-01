import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updatePlantDisplay: vi.fn(),
  getPlantLOD: vi.fn(() => 'icon+label'),
  updatePlantCounterScale: vi.fn(),
  updatePlantDensity: vi.fn(),
  updatePlantLOD: vi.fn(),
  updatePlantStacking: vi.fn(),
  updatePlantLabelsForLocale: vi.fn(() => Promise.resolve()),
  updateAnnotationsForZoom: vi.fn(),
  updateGuideLines: vi.fn(),
  refreshGridColors: vi.fn(),
  refreshCanvasTheme: vi.fn(),
  updateHtmlRulers: vi.fn(),
  refreshRulerColors: vi.fn(),
}))

vi.mock('../canvas/display-modes', () => ({
  updatePlantDisplay: mocks.updatePlantDisplay,
}))

vi.mock('../canvas/plants', () => ({
  getPlantLOD: mocks.getPlantLOD,
  updatePlantCounterScale: mocks.updatePlantCounterScale,
  updatePlantDensity: mocks.updatePlantDensity,
  updatePlantLOD: mocks.updatePlantLOD,
  updatePlantStacking: mocks.updatePlantStacking,
  updatePlantLabelsForLocale: mocks.updatePlantLabelsForLocale,
}))

vi.mock('../canvas/shapes', () => ({
  updateAnnotationsForZoom: mocks.updateAnnotationsForZoom,
}))

vi.mock('../canvas/guides', () => ({
  updateGuideLines: mocks.updateGuideLines,
}))

vi.mock('../canvas/grid', () => ({
  refreshGridColors: mocks.refreshGridColors,
}))

vi.mock('../canvas/theme-refresh', () => ({
  refreshCanvasTheme: mocks.refreshCanvasTheme,
}))

vi.mock('../canvas/rulers', () => ({
  updateHtmlRulers: mocks.updateHtmlRulers,
  refreshRulerColors: mocks.refreshRulerColors,
}))

import { guides, plantColorByAttr, plantDisplayMode, zoomLevel, zoomReference } from '../state/canvas'
import { locale, theme } from '../state/app'
import { CanvasRenderPipeline } from '../canvas/runtime/render-pipeline'
import { RenderReconciler } from '../canvas/runtime/render-reconciler'

function makeLayer() {
  return {
    batchDraw: vi.fn(),
  } as any
}

function makeStage() {
  return {
    scaleX: () => zoomLevel.value,
    container: () => ({ id: 'canvas-container' }),
    findOne: vi.fn(() => null),
    setAttrs: vi.fn((attrs: Record<string, number>) => {
      if (typeof attrs.scaleX === 'number') zoomLevel.value = attrs.scaleX
    }),
  } as any
}

describe('Canvas renderer ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})

    Object.values(mocks).forEach((mock) => {
      if ('mockClear' in mock) {
        ;(mock as ReturnType<typeof vi.fn>).mockClear()
      }
    })

    guides.value = []
    plantDisplayMode.value = 'default'
    plantColorByAttr.value = 'stratum'
    zoomLevel.value = 2
    zoomReference.value = 8
    locale.value = 'en'
    theme.value = 'light'
  })

  it('reconciler flushes display, zoom-dependent state, theme, and overlays after invalidation', () => {
    const plantsLayer = makeLayer()
    const annotationsLayer = makeLayer()
    const baseLayer = makeLayer()
    const uiLayer = makeLayer()
    const pipeline = new CanvasRenderPipeline({
      stage: makeStage(),
      layers: new Map([
        ['plants', plantsLayer],
        ['annotations', annotationsLayer],
        ['base', baseLayer],
        ['ui', uiLayer],
      ]),
      getHtmlRulers: () => null,
      getSpeciesCache: () => new Map(),
      loadSpeciesCache: vi.fn(async () => {}),
    })
    const reconciler = new RenderReconciler({
      stage: makeStage(),
      pipeline,
      getVisiblePlantsForDeferredPasses: () => [],
    })

    reconciler.invalidate(
      'counter-scale',
      'plant-display',
      'lod',
      'annotations',
      'theme',
      'overlays',
    )

    expect(mocks.updatePlantCounterScale).toHaveBeenCalledWith(plantsLayer, 2)
    expect(mocks.updatePlantDisplay).toHaveBeenCalledWith(
      plantsLayer,
      'default',
      'stratum',
      2,
      8,
      expect.any(Map),
    )
    expect(mocks.getPlantLOD).toHaveBeenCalledWith(2)
    expect(mocks.updatePlantLOD).toHaveBeenCalledWith(plantsLayer, 'icon+label', expect.any(Set))
    expect(mocks.updateAnnotationsForZoom).toHaveBeenCalledWith(annotationsLayer, 2)
    expect(mocks.refreshCanvasTheme).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Map),
    )
    expect(baseLayer.batchDraw).toHaveBeenCalled()
    expect(uiLayer.batchDraw).toHaveBeenCalled()
  })

  it('refreshes locale-dependent labels without touching unrelated layers', async () => {
    const plantsLayer = makeLayer()

    const pipeline = new CanvasRenderPipeline({
      stage: {
        scaleX: () => 1,
        container: () => null,
        findOne: vi.fn(() => null),
      } as any,
      layers: new Map([['plants', plantsLayer]]),
      getHtmlRulers: () => null,
      getSpeciesCache: () => new Map(),
      loadSpeciesCache: vi.fn(async () => {}),
    })

    pipeline.refreshLocale('fr')
    await Promise.resolve()

    expect(mocks.updatePlantLabelsForLocale).toHaveBeenCalledWith(plantsLayer, 'fr')
  })

  it('coalesces repeated deferred density and stacking invalidations', () => {
    const group = { getAbsolutePosition: () => ({ x: 10, y: 20 }) } as any
    const pipeline = new CanvasRenderPipeline({
      stage: makeStage(),
      layers: new Map([['plants', makeLayer()]]),
      getHtmlRulers: () => null,
      getSpeciesCache: () => new Map(),
      loadSpeciesCache: vi.fn(async () => {}),
    })
    const reconciler = new RenderReconciler({
      stage: makeStage(),
      pipeline,
      getVisiblePlantsForDeferredPasses: () => [group],
    })

    reconciler.invalidate('density')
    reconciler.invalidate('stacking')
    vi.runAllTimers()

    expect(mocks.updatePlantDensity).toHaveBeenCalledTimes(1)
    expect(mocks.updatePlantStacking).toHaveBeenCalledTimes(1)
  })
})
