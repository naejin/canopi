// Production CSP rejects Pixi's generated functions; its shim avoids eval.
import 'pixi.js/unsafe-eval'
import { Text } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import {
  getAnnotationPresentation,
  getAnnotationVisualWorldBounds,
  isPointInAnnotationPresentation,
  onAnnotationFontLoad,
} from '../canvas/runtime/annotation-layout'
import { getCanvasDetailLayout } from '../canvas/runtime/automatic-detail'
import {
  createDefaultScenePersistedState,
  SceneStore,
  type SceneAnnotationEntity,
  type SceneDesignObjectSelection,
  type ScenePersistedState,
} from '../canvas/runtime/scene'
import { SceneRuntimePresentationController } from '../canvas/runtime/scene-runtime/presentation'
import { createBillboardLayer } from '../canvas/runtime/renderers/billboard-layer'
import { getDesignObjectSelectionModel } from '../canvas/runtime/scene-runtime/selection'
import { projectScenePlantLabels } from '../canvas/runtime/selection-labels'
import { selectionScreenHull } from '../canvas/runtime/tools/select/selection-hull'
import type { ToolScene } from '../canvas/runtime/tools/tool'
import { createTestRendererView, createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'
import { createZoomCalibrationScene } from './support/zoom-calibration-scenes'

// jsdom has no 2D canvas and no font loading API, so this file measures through stubs: a context whose glyphs are half
// an em wide once the web font has loaded and 0.56 em before, and a font set whose loads the test resolves.
const fontSet = { loaded: true, finishLoad: null as (() => void) | null }
Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: {
    check: () => fontSet.loaded,
    load: () => new Promise<unknown[]>((resolve) => {
      fontSet.finishLoad = () => { fontSet.loaded = true; resolve([{}]) }
    }),
  },
})
vi.stubGlobal('OffscreenCanvas', class {
  getContext() {
    return {
      font: '',
      measureText(this: { font: string }, text: string) {
        const width = Array.from(text).length * Number.parseFloat(this.font) * (fontSet.loaded ? 0.5 : 0.56)
        return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width - 1 }
      },
    }
  }
})

const SCALE = 20

function noteScene(text: string): ScenePersistedState {
  const note: SceneAnnotationEntity = { kind: 'annotation', id: 'note', annotationType: 'text', position: { x: 3, y: 4 },
    text, fontSize: 16, rotationDeg: 0, locked: false }
  return { ...createDefaultScenePersistedState(), annotations: [note] }
}

/** The note's frame width in CSS px as each reader sees it at SCALE, to a thousandth of a pixel. */
function widthsRead(scene: ScenePersistedState) {
  const note = scene.annotations[0]!
  const selection: SceneDesignObjectSelection = [{ kind: 'annotation', id: note.id }]
  const model = getDesignObjectSelectionModel(scene, selection, {
    annotationViewportScale: SCALE,
    revealedAnnotationId: note.id,
    plantContext: { pixelsPerMetre: SCALE, speciesCache: new Map(), localizedCommonNames: new Map() },
  })
  const hull = selectionScreenHull({ persisted: scene, selection: () => selection } as unknown as ToolScene, model, {
    metresPerPixelAt: () => 1 / SCALE,
    screenAxesInWorld: () => ({ right: { x: 1, y: 0 }, down: { x: 0, y: 1 } }),
  })!
  const px = (value: number) => Math.round(value * 1000) / 1000
  return {
    frame: px(getAnnotationPresentation(note, SCALE, true).textFrame.widthPx),
    detail: px(getCanvasDetailLayout(scene, SCALE).bounds[0]!.width - 4),
    selection: px((model.bounds!.maxX - model.bounds!.minX) * SCALE),
    hull: px((hull[1].x - hull[0].x) * SCALE),
  }
}

describe('scene text presentation', () => {
  it('keeps marker geometry upright and switches to authored rotated text at half opacity', () => {
    const note = { ...createZoomCalibrationScene('garden').annotations[1]!, position: { x: 10, y: 20 }, rotationDeg: 90 }
    expect(getAnnotationVisualWorldBounds(note, 4)).toEqual({ x: 9, y: 19, width: 2, height: 2 })
    expect(getAnnotationPresentation(note, 13.99).markerOwnsGeometry).toBe(true)
    expect(getAnnotationPresentation(note, 14).markerOwnsGeometry).toBe(false)
    expect(getAnnotationPresentation(note, 4, true)).toMatchObject({ textOpacity: 1, markerOpacity: 0, markerOwnsGeometry: false })
  })

  it('projects a direct singleton Annotation reveal without revealing group or mixed selection', () => {
    const store = new SceneStore()
    store.updatePersisted((scene) => Object.assign(scene, createZoomCalibrationScene('garden')))
    const presentation = new SceneRuntimePresentationController({ sceneStore: store,
      readPixelsPerMetre: () => 4, getLocale: () => 'en',
      resolveHighlightedTargets: () => ({ plantIds: [], zoneIds: [] }), onPlantNamesChanged: () => {},
    })
    for (const selection of [
      [{ kind: 'annotation', id: 'note-0' }],
      [{ kind: 'annotation', id: 'note-0' }, { kind: 'plant', id: 'plant-0' }],
      [{ kind: 'group', id: 'guild' }],
    ] satisfies SceneDesignObjectSelection[]) {
      store.setSelection(selection)
      expect(presentation.buildRendererSnapshot().revealedAnnotationId).toBe(selection.length === 1 && selection[0]?.kind === 'annotation' ? 'note-0' : null)
    }
  })

  it('reveals a name only for direct singleton selection, without modifying the Design', () => {
    const store = new SceneStore()
    store.updatePersisted((scene) => Object.assign(scene, createZoomCalibrationScene('garden')))
    const before = store.persisted
    const presentation = new SceneRuntimePresentationController({
      sceneStore: store, readPixelsPerMetre: () => 4,
      getLocale: () => 'en', resolveHighlightedTargets: () => ({ plantIds: [], zoneIds: [] }),
      onPlantNamesChanged: () => {},
    })
    const selections: SceneDesignObjectSelection[] = [
      [{ kind: 'plant', id: 'plant-1' }],
      [{ kind: 'plant', id: 'plant-1' }, { kind: 'annotation', id: 'note-0' }],
      [{ kind: 'group', id: store.persisted.groups[0]!.id }],
      [{ kind: 'plant', id: 'plant-2' }],
      [{ kind: 'plant', id: 'plant-0' }],
    ]
    const snapshots = selections.map((selection) => {
      store.setSelection(selection)
      return presentation.buildRendererSnapshot()
    })
    const labels = snapshots.map((snapshot) => projectScenePlantLabels(snapshot, 4))
    expect(labels.map(({ pinnedPlantNameLabels }) => pinnedPlantNameLabels.map((label) => label.plantId)))
      .toEqual([['plant-1'], [], [], ['plant-2'], []])
    expect(labels.map(({ selectionLabels }) => selectionLabels.length)).toEqual([0, 0, 0, 0, 1])
    expect(store.persisted).toEqual(before)
  })

  it('a note\'s frame, click target, detail bounds and hull read its measured width', () => {
    const scene = noteScene('Hazelnut hedge, prune in February')
    const note = scene.annotations[0]!
    // 33 glyphs at 16 px, half an em each: the measured 264 px, not the 316.8 px of the 0.6 em estimate.
    expect(widthsRead(scene)).toEqual({ frame: 264, detail: 264, selection: 264, hull: 264 })

    // The click target is the drawn outline: the text plus 4 px each side, 2 px above and below (Q7).
    const at = (x: number, y: number) => isPointInAnnotationPresentation(
      note, { x: note.position.x + x / SCALE, y: note.position.y + y / SCALE }, SCALE)
    expect([at(-3.5, 10), at(267.5, 10), at(100, -1.5), at(100, 21.5)]).toEqual([true, true, true, true])
    expect([at(-4.5, 10), at(268.5, 10), at(100, -2.5), at(100, 22.5)]).toEqual([false, false, false, false])
    expect(at(284, 10), 'a click 20 px right of the text').toBe(false)
  })

  it('a font load re-measures the note and every memo follows', async () => {
    const scene = noteScene('Pond')
    const loads = vi.fn()
    const stopListening = onAnnotationFontLoad(loads)
    try {
      fontSet.loaded = false
      // 4 glyphs of the fallback font, 0.56 em each.
      expect(widthsRead(scene)).toEqual({ frame: 35.84, detail: 35.84, selection: 35.84, hull: 35.84 })

      fontSet.finishLoad!()
      await vi.waitFor(() => expect(loads).toHaveBeenCalledTimes(1))

      expect(widthsRead(scene)).toEqual({ frame: 32, detail: 32, selection: 32, hull: 32 })
    } finally {
      stopListening()
      fontSet.loaded = true
    }
  })

  it('a font load draws the note\'s text anew, as its outline is measured anew', async () => {
    // Pixi keeps a text's raster while its text and style stay the same, and nothing in Pixi listens for fonts: a text
    // drawn in the fallback would keep the fallback's glyphs inside an outline measured in the web font.
    const scene = noteScene('Willow cuttings')
    const snapshot = () => createTestSceneRendererSnapshot({ scene, selectedTargets: [{ kind: 'annotation', id: 'note' }] })
    const view = createTestRendererView({ x: 0, y: 0, scale: SCALE })
    const layer = createBillboardLayer({ createText: () => new Text(), viewSize: { width: 400, height: 300 } })
    const noteText = () => layer.root.children.flatMap((layerRoot) => layerRoot.children)
      .find((node): node is Text => node instanceof Text && node.text === 'Willow cuttings')!
    const loads = vi.fn()
    const stopListening = onAnnotationFontLoad(loads)
    try {
      fontSet.loaded = false
      layer.present(view, snapshot())
      const drawnInFallback = noteText()
      layer.present(view, snapshot())
      expect(noteText(), 'a scene sync keeps the drawn text').toBe(drawnInFallback)

      fontSet.finishLoad!()
      await vi.waitFor(() => expect(loads).toHaveBeenCalledTimes(1))
      // The runtime syncs the scene on the load (scene-runtime.ts).
      layer.present(view, snapshot())
      expect(drawnInFallback.destroyed, 'the fallback raster is let go').toBe(true)
      expect(noteText()).toBeDefined()
      expect(noteText()).not.toBe(drawnInFallback)
    } finally {
      stopListening()
      fontSet.loaded = true
      layer.dispose()
    }
  })
})
