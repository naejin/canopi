import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updatePlantDisplay: vi.fn(),
  getPlantLOD: vi.fn(() => 'icon+label'),
  updatePlantsLOD: vi.fn(),
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
  updatePlantsLOD: mocks.updatePlantsLOD,
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

import { guides, plantColorByAttr, plantDisplayMode, selectedObjectIds, zoomLevel } from '../state/canvas'
import { locale, theme } from '../state/app'
import { CanvasRenderPipeline } from '../canvas/runtime/render-pipeline'

function makeLayer() {
  return {
    batchDraw: vi.fn(),
  } as any
}

describe('CanvasRenderPipeline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})

    mocks.updatePlantDisplay.mockClear()
    mocks.getPlantLOD.mockClear()
    mocks.updatePlantsLOD.mockClear()
    mocks.updatePlantLabelsForLocale.mockClear()
    mocks.updateAnnotationsForZoom.mockClear()
    mocks.updateGuideLines.mockClear()
    mocks.refreshGridColors.mockClear()
    mocks.refreshCanvasTheme.mockClear()
    mocks.updateHtmlRulers.mockClear()
    mocks.refreshRulerColors.mockClear()

    guides.value = []
    plantDisplayMode.value = 'default'
    plantColorByAttr.value = 'stratum'
    selectedObjectIds.value = new Set(['plant-1'])
    zoomLevel.value = 2
    locale.value = 'en'
    theme.value = 'light'
  })

  it('reconciles display, zoom-dependent state, theme, and overlay redraw after materialization', () => {
    const plantsLayer = makeLayer()
    const annotationsLayer = makeLayer()
    const baseLayer = makeLayer()
    const uiLayer = makeLayer()
    const stage = {
      scaleX: () => 2,
      container: () => ({ id: 'canvas-container' }),
      findOne: vi.fn(() => null),
    } as any

    const pipeline = new CanvasRenderPipeline({
      stage,
      layers: new Map([
        ['plants', plantsLayer],
        ['annotations', annotationsLayer],
        ['base', baseLayer],
        ['ui', uiLayer],
      ]),
      getHtmlRulers: () => null,
      getScaleBar: () => null,
      getSpeciesCache: () => new Map(),
      loadSpeciesCache: vi.fn(async () => {}),
    })

    pipeline.reconcileAfterMaterialization()

    expect(mocks.updatePlantDisplay).toHaveBeenCalledWith(
      plantsLayer,
      'default',
      'stratum',
      2,
      expect.any(Map),
    )
    expect(mocks.getPlantLOD).toHaveBeenCalledWith(2)
    expect(mocks.updatePlantsLOD).toHaveBeenCalledWith(plantsLayer, 'icon+label', 2, selectedObjectIds.value)
    expect(mocks.updateAnnotationsForZoom).toHaveBeenCalledWith(annotationsLayer, 2)
    expect(mocks.refreshCanvasTheme).toHaveBeenCalledWith(
      stage.container(),
      expect.any(Map),
      null,
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
      getScaleBar: () => null,
      getSpeciesCache: () => new Map(),
      loadSpeciesCache: vi.fn(async () => {}),
    })

    pipeline.refreshLocale('fr')
    await Promise.resolve()

    expect(mocks.updatePlantLabelsForLocale).toHaveBeenCalledWith(plantsLayer, 'fr')
  })

  it('schedules a single deferred zoom reconciliation pass', () => {
    const plantsLayer = makeLayer()
    const annotationsLayer = makeLayer()

    const pipeline = new CanvasRenderPipeline({
      stage: {
        scaleX: () => 3,
        container: () => null,
        findOne: vi.fn(() => null),
      } as any,
      layers: new Map([
        ['plants', plantsLayer],
        ['annotations', annotationsLayer],
      ]),
      getHtmlRulers: () => null,
      getScaleBar: () => null,
      getSpeciesCache: () => new Map(),
      loadSpeciesCache: vi.fn(async () => {}),
    })

    zoomLevel.value = 3
    pipeline.scheduleLODUpdate()
    pipeline.scheduleLODUpdate()

    vi.runAllTimers()

    expect(mocks.getPlantLOD).toHaveBeenCalledTimes(1)
    expect(mocks.getPlantLOD).toHaveBeenCalledWith(3)
    expect(mocks.updatePlantsLOD).toHaveBeenCalledWith(plantsLayer, 'icon+label', 3, selectedObjectIds.value)
    expect(mocks.updateAnnotationsForZoom).toHaveBeenCalledWith(annotationsLayer, 3)
  })
})
