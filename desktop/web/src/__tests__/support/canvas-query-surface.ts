import { computeScenePhysicalExtentMeters } from '../../canvas/runtime/scene-physical-extent'
import { buildCanvasPrintSnapshot } from '../../canvas/runtime/print-snapshot'
import { createTestSceneRendererSnapshot } from './scene-renderer-snapshot'
import { signal } from '@preact/signals'
import type { CameraViewportSnapshot } from '../../canvas/runtime/camera'
import {
  createDefaultScenePersistedState,
  type SceneDesignObjectSelection,
  type ScenePersistedState,
  type SceneViewportState,
} from '../../canvas/runtime/scene'
import type {
  CanvasPlantLabelCoverage,
  CanvasQuerySurface,
} from '../../canvas/runtime/runtime'
import type { PlacedPlant } from '../../types/design'
import { createSessionPlane, type SessionPlane } from '../../canvas/session-plane'
import { TEST_GEO_ORIGIN } from './geo-design'

interface TestCanvasQuerySurfaceOptions {
  readonly scene?: ScenePersistedState
  readonly viewport?: SceneViewportState
  readonly plants?: readonly PlacedPlant[]
  readonly localizedNames?: ReadonlyMap<string, string | null>
  /** English catalog names shown for species with no name in the active locale. */
  readonly englishFallbackNames?: ReadonlyMap<string, string>
  readonly selection?: SceneDesignObjectSelection
  /** Defaults to a plane at the shared test origin; pass `null` for no Design frame. */
  readonly sessionPlane?: SessionPlane | null
  readonly plantLabelCoverage?: CanvasPlantLabelCoverage
}

export type TestCanvasQuerySurface = CanvasQuerySurface & {
  bumpSceneRevision(): void
  bumpPlantNamesRevision(): void
  setSettled(settled: boolean): void
  setPlants(plants: readonly PlacedPlant[]): void
  setLocalizedNames(names: ReadonlyMap<string, string | null>): void
  setEnglishFallbackNames(names: ReadonlyMap<string, string>): void
  setSelection(selection: SceneDesignObjectSelection): void
}

export function createTestCanvasQuerySurface({
  scene = createDefaultScenePersistedState(),
  viewport = { x: 0, y: 0, scale: 1 },
  plants = [],
  localizedNames = new Map(),
  englishFallbackNames = new Map(),
  selection = [],
  sessionPlane = createSessionPlane(TEST_GEO_ORIGIN),
  plantLabelCoverage = { labelled: 0, inView: 0 },
}: TestCanvasQuerySurfaceOptions = {}): TestCanvasQuerySurface {
  const sessionPlaneSignal = signal<SessionPlane | null>(sessionPlane)
  const sceneRevision = signal(0)
  const plantNamesRevision = signal(0)
  const viewportSnapshot = signal<CameraViewportSnapshot>({
    viewport,
    screenSize: { width: 400, height: 300 },
    devicePixelRatio: 1,
    referenceScale: 1,
    scaleBounds: { minimum: 0.00001, maximum: 2000 },
    overviewScaleThreshold: 0.1,
    mode: viewport.scale < 0.1 ? 'overview' : 'site',
    groundMetersPerCssPixel: null,
    revision: 0,
  })
  const admissionRevision = signal(0)
  const revision = {
    scene: sceneRevision,
    plantNames: plantNamesRevision,
  }
  let currentPlants = [...plants]
  let currentLocalizedNames = localizedNames
  let currentEnglishFallbackNames = englishFallbackNames
  let currentSelection = selection.map((target) => ({ ...target }))
  let settled = true

  return {
    revision,
    viewport: viewportSnapshot,
    sessionPlane: sessionPlaneSignal,
    getSpeciesFocus: () => ({ canonicalName: null }),
    getPlantLabelCoverage: () => plantLabelCoverage,
    capturePrintSnapshot: () => {
      void admissionRevision.value
      return settled ? buildCanvasPrintSnapshot(scene, { viewport, speciesCache: new Map() }) : null
    },
    captureViewScene: (request) => {
      void admissionRevision.value
      if (!settled) return null
      const visible = new Set(request.visibleLayerNames)
      return createTestSceneRendererSnapshot({
        scene: { ...scene, layers: scene.layers.map((layer) => ({ ...layer, visible: visible.has(layer.name) })) },
        viewport: request.viewport,
        speciesFocus: { canonicalName: request.focusedSpecies },
      })
    },
    getScenePhysicalExtentMeters: () => computeScenePhysicalExtentMeters(scene),
    getSceneSnapshot: () => scene,
    getSelection: () => currentSelection.map((target) => ({ ...target })),
    getDesignObjectSelection: () => ({
      // The selection as the runtime models it; this surface has no locks.
      editableTargets: currentSelection.map((target) => ({ ...target })),
      lockedTargets: [],
      blockedTargets: [],
      bounds: null,
      sameSpeciesReferenceCanonicalName: null,
      plantNamePinning: {
        plantIds: [],
        allPinned: false,
      },
    }),
    getSelectedPlantColorContext: () => ({
      plantIds: currentSelection
        .filter((target) => target.kind === 'plant')
        .map((target) => target.id),
      singleSpeciesCanonicalName: null,
      singleSpeciesCommonName: null,
      sharedCurrentColor: null,
      suggestedColor: null,
      singleSpeciesDefaultColor: null,
    }),
    getSelectedPlantSymbolContext: () => ({
      plantIds: [],
      singleSpeciesCanonicalName: null,
      singleSpeciesCommonName: null,
      sharedCurrentSymbol: null,
      sharedEffectiveSymbol: 'round',
      inheritedSymbol: null,
      singleSpeciesDefaultSymbol: null,
      canClearSelectedSymbol: false,
    }),
    getPlacedPlants: () => [...currentPlants],
    getSettledPlacedPlants: () => {
      void admissionRevision.value
      return settled ? [...currentPlants] : null
    },
    getSettledDesignObjects: () => {
      void admissionRevision.value
      return settled
        ? { plants: [...currentPlants], zones: [], annotations: [], measurementGuides: [], groups: [] }
        : null
    },
    getLocalizedCommonNames: () => currentLocalizedNames,
    getEnglishFallbackNames: () => currentEnglishFallbackNames,
    bumpSceneRevision: () => {
      sceneRevision.value += 1
    },
    bumpPlantNamesRevision: () => {
      plantNamesRevision.value += 1
    },
    setSettled: (nextSettled) => {
      if (settled === nextSettled) return
      settled = nextSettled
      admissionRevision.value += 1
    },
    setPlants: (nextPlants) => {
      currentPlants = [...nextPlants]
    },
    setLocalizedNames: (names) => {
      currentLocalizedNames = names
    },
    setEnglishFallbackNames: (names) => {
      currentEnglishFallbackNames = names
    },
    setSelection: (nextSelection) => {
      currentSelection = nextSelection.map((target) => ({ ...target }))
    },
  }
}
