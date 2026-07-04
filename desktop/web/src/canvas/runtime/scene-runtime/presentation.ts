import { computePinnedPlantNameLabels, computeSelectionLabels } from '../selection-labels'
import {
  resolvePlantCanopySpreadM,
  resolvePlantStratum,
  type PlantPresentationContext,
} from '../plant-presentation'
import {
  createDetachedCanvasPlantLabelSource,
  createDetachedCanvasSpeciesPresentationCache,
  type CanvasPlantLabelSource,
  type CanvasSpeciesPresentationCache,
} from '../presentation-data'
import type { SceneRendererHoverTarget, SceneRendererSnapshot } from '../renderers/scene-types'
import type { ScenePersistedState, SceneStore, SceneViewportState } from '../scene'
import { isSceneDesignObjectLocked } from '../scene'
import { resolveSceneObjectGroupMembers, sceneObjectGroupMemberLayerName } from '../scene'
import {
  getSelectedAnnotationIds,
  getSelectedMeasurementGuideIds,
  getSelectedPlantIds,
  getSelectedZoneIds,
} from './selection'

interface SceneRuntimePresentationControllerOptions {
  sceneStore: SceneStore
  getViewport(): SceneViewportState
  getLocale(): string
  resolveHighlightedTargets(scene: ScenePersistedState): {
    plantIds: readonly string[]
    zoneIds: readonly string[]
  }
  onPlantNamesChanged(): void
  speciesCache?: CanvasSpeciesPresentationCache
  plantLabels?: CanvasPlantLabelSource
}

export interface ScenePresentationRefreshResult {
  changed: boolean
  backfills: PlantPresentationBackfill[] | null
}

export interface PlantPresentationBackfill {
  plantId: string
  stratum: string | null
  canopySpreadM: number | null
  scale: number | null
}

export class SceneRuntimePresentationController {
  private readonly _sceneStore: SceneStore
  private readonly _getViewport: () => SceneViewportState
  private readonly _getLocale: () => string
  private readonly _resolveHighlightedTargets: SceneRuntimePresentationControllerOptions['resolveHighlightedTargets']
  private readonly _onPlantNamesChanged: () => void
  private readonly _speciesCache: CanvasSpeciesPresentationCache
  private readonly _plantLabels: CanvasPlantLabelSource

  constructor(options: SceneRuntimePresentationControllerOptions) {
    this._sceneStore = options.sceneStore
    this._getViewport = options.getViewport
    this._getLocale = options.getLocale
    this._resolveHighlightedTargets = options.resolveHighlightedTargets
    this._onPlantNamesChanged = options.onPlantNamesChanged
    this._speciesCache = options.speciesCache ?? createDetachedCanvasSpeciesPresentationCache()
    this._plantLabels = options.plantLabels ?? createDetachedCanvasPlantLabelSource()
  }

  getSpeciesCache() {
    return this._speciesCache.getCache()
  }

  getLocalizedCommonNames(): ReadonlyMap<string, string | null> {
    return this._plantLabels.getLocaleSnapshot(this._getLocale())
  }

  getSuggestedPlantColor(canonicalName: string): string | null {
    return this._speciesCache.getSuggestedPlantColor(canonicalName)
  }

  createPlantPresentationContext(viewportScale = this._getViewport().scale): PlantPresentationContext {
    return {
      viewport: {
        x: 0,
        y: 0,
        scale: viewportScale,
      },
      speciesCache: this._speciesCache.getCache(),
      localizedCommonNames: this.getLocalizedCommonNames(),
    }
  }

  buildRendererSnapshot(): SceneRendererSnapshot {
    const scene = this._sceneStore.persisted
    const session = this._sceneStore.session
    const hoveredPlant = session.hoveredEntityId
      ? scene.plants.find((plant) => plant.id === session.hoveredEntityId)
      : null
    const highlightedTargets = this._resolveHighlightedTargets(scene)
    const localizedCommonNames = this.getLocalizedCommonNames()

    const viewport = this._getViewport()
    const plantContext = {
      viewport,
      speciesCache: this._speciesCache.getCache(),
      localizedCommonNames,
    }

    return {
      scene,
      viewport,
      selectedEntityIds: session.selectedEntityIds,
      selectedPlantIds: getSelectedPlantIds(scene, session.selectedEntityIds),
      selectedZoneIds: getSelectedZoneIds(scene, session.selectedEntityIds),
      selectedAnnotationIds: getSelectedAnnotationIds(scene, session.selectedEntityIds),
      selectedMeasurementGuideIds: getSelectedMeasurementGuideIds(scene, session.selectedEntityIds),
      highlightedPlantIds: new Set(highlightedTargets.plantIds),
      highlightedZoneIds: new Set(highlightedTargets.zoneIds),
      speciesCache: this._speciesCache.getCache(),
      localizedCommonNames,
      hoveredCanonicalName: hoveredPlant?.canonicalName ?? null,
      hoverTarget: getRendererHoverTarget(scene, session.hoveredEntityId),
      pinnedPlantNameLabels: computePinnedPlantNameLabels(
        scene.plants,
        viewport,
        localizedCommonNames,
        { plantContext },
      ),
      selectionLabels: computeSelectionLabels(
        scene.plants,
        session.selectedEntityIds,
        viewport,
        localizedCommonNames,
        { plantContext },
      ),
    }
  }

  async refreshSpeciesCacheEntries(
    canonicalNames: string[],
    activeLocale: string,
  ): Promise<ScenePresentationRefreshResult> {
    const labelsChanged = await this._plantLabels.ensureEntries(canonicalNames, activeLocale)
    if (labelsChanged) this._onPlantNamesChanged()
    const loaded = await this._speciesCache.ensureEntries(canonicalNames, activeLocale)
    const backfills = this.derivePresentationBackfills()
    return {
      changed: labelsChanged || loaded || backfills !== null,
      backfills,
    }
  }

  async refreshCurrentPresentationData(): Promise<ScenePresentationRefreshResult> {
    const plants = this._sceneStore.persisted.plants
    const canonicalNames = [...new Set(plants.map((plant) => plant.canonicalName))]
    if (canonicalNames.length === 0) {
      return { changed: false, backfills: null }
    }

    const labelsChanged = await this._plantLabels.ensureEntries(canonicalNames, this._getLocale())
    if (labelsChanged) this._onPlantNamesChanged()

    const needsSpeciesCache = plants.some((plant) => plant.stratum === null || plant.canopySpreadM === null)
    if (!needsSpeciesCache) {
      return {
        changed: labelsChanged,
        backfills: null,
      }
    }

    const loaded = await this._speciesCache.ensureEntries(canonicalNames, this._getLocale())
    const backfills = this.derivePresentationBackfills()
    return {
      changed: labelsChanged || loaded || backfills !== null,
      backfills,
    }
  }

  derivePresentationBackfills(): PlantPresentationBackfill[] | null {
    const speciesCache = this._speciesCache.getCache()
    const backfills: PlantPresentationBackfill[] = []
    for (const plant of this._sceneStore.persisted.plants) {
      const nextStratum = resolvePlantStratum(plant, speciesCache)
      const nextCanopySpreadM = resolvePlantCanopySpreadM(plant, speciesCache)
      const nextScale = nextCanopySpreadM ?? plant.scale
      if (
        nextStratum === plant.stratum
        && nextCanopySpreadM === plant.canopySpreadM
        && nextScale === plant.scale
      ) {
        continue
      }
      backfills.push({
        plantId: plant.id,
        stratum: nextStratum,
        canopySpreadM: nextCanopySpreadM,
        scale: nextScale,
      })
    }
    return backfills.length > 0 ? backfills : null
  }
}

function getRendererHoverTarget(
  scene: ScenePersistedState,
  hoveredId: string | null,
): SceneRendererHoverTarget | null {
  if (!hoveredId) return null

  const target = resolveHoverTarget(scene, hoveredId)
  if (!target) return null
  const layerLocked = isHoverTargetLayerLocked(scene, target)
  const state = layerLocked
    ? 'locked-layer'
    : isSceneDesignObjectLocked(scene, target.id)
      ? 'locked-design-object'
      : 'hover'
  return { ...target, state }
}

function resolveHoverTarget(
  scene: ScenePersistedState,
  id: string,
): Omit<SceneRendererHoverTarget, 'state'> | null {
  if (scene.groups.some((group) => group.id === id)) return { kind: 'group', id }
  if (scene.plants.some((plant) => plant.id === id)) return { kind: 'plant', id }
  if (scene.zones.some((zone) => zone.name === id)) return { kind: 'zone', id }
  if (scene.annotations.some((annotation) => annotation.id === id)) return { kind: 'annotation', id }
  if ((scene.measurementGuides ?? []).some((guide) => guide.id === id)) return { kind: 'measurement-guide', id }
  return null
}

function isHoverTargetLayerLocked(
  scene: ScenePersistedState,
  target: Omit<SceneRendererHoverTarget, 'state'>,
): boolean {
  return getHoverTargetLayers(scene, target)
    .some((layerName) => scene.layers.find((entry) => entry.name === layerName)?.locked === true)
}

function getHoverTargetLayers(
  scene: ScenePersistedState,
  target: Omit<SceneRendererHoverTarget, 'state'>,
): string[] {
  if (target.kind === 'group') {
    const group = scene.groups.find((entry) => entry.id === target.id)
    if (!group) return []
    return [...new Set(resolveSceneObjectGroupMembers(scene, group).map(sceneObjectGroupMemberLayerName))]
  }
  if (target.kind === 'zone') return ['zones']
  if (target.kind === 'annotation') return ['annotations']
  if (target.kind === 'measurement-guide') return ['measurement-guides']
  return ['plants']
}
