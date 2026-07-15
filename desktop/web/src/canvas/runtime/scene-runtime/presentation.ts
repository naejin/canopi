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
import type {
  SceneDesignObjectTarget,
  ScenePersistedState,
  SceneStateReader,
  SceneViewportState,
} from '../scene'
import { isSceneDesignObjectLocked } from '../scene'
import { resolveSceneObjectGroupMembers, sceneObjectGroupMemberLayerName } from '../scene'
import { projectSceneSelectionEntityIds } from './selection'

interface SceneRuntimePresentationControllerOptions {
  sceneStore: SceneStateReader
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
  plantNamesRevision: number
  backfills: PlantPresentationBackfill[] | null
  failure: { readonly error: unknown } | null
}

export interface PlantPresentationBackfill {
  plantId: string
  canonicalName: string
  stratum: string | null
  canopySpreadM: number | null
  scale: number | null
}

export class SceneRuntimePresentationController {
  private readonly _sceneStore: SceneStateReader
  private readonly _getViewport: () => SceneViewportState
  private readonly _getLocale: () => string
  private readonly _resolveHighlightedTargets: SceneRuntimePresentationControllerOptions['resolveHighlightedTargets']
  private readonly _onPlantNamesChanged: () => void
  private readonly _speciesCache: CanvasSpeciesPresentationCache
  private readonly _plantLabels: CanvasPlantLabelSource
  private _preparedPlantNamesRevision = 0
  private _publishedPlantNamesRevision = 0

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
    const hoveredPlant = session.hoveredTarget?.kind === 'plant'
      ? scene.plants.find((plant) => plant.id === session.hoveredTarget?.id)
      : null
    const highlightedTargets = this._resolveHighlightedTargets(scene)
    const localizedCommonNames = this.getLocalizedCommonNames()

    const viewport = this._getViewport()
    const plantContext = {
      viewport,
      speciesCache: this._speciesCache.getCache(),
      localizedCommonNames,
    }
    const selectionLabelPlantIds = session.selectedTargets.length === 1
      && session.selectedTargets[0]?.kind === 'plant'
      ? new Set([session.selectedTargets[0].id])
      : new Set<string>()
    const selectionProjection = projectSceneSelectionEntityIds(scene, session.selectedTargets)

    return {
      scene,
      viewport,
      selectionLabelPlantIds,
      ...selectionProjection,
      highlightedPlantIds: new Set(highlightedTargets.plantIds),
      highlightedZoneIds: new Set(highlightedTargets.zoneIds),
      speciesCache: this._speciesCache.getCache(),
      localizedCommonNames,
      hoveredCanonicalName: hoveredPlant?.canonicalName ?? null,
      hoverTarget: getRendererHoverTarget(scene, session.hoveredTarget),
      pinnedPlantNameLabels: computePinnedPlantNameLabels(
        scene.plants,
        viewport,
        localizedCommonNames,
        { plantContext },
      ),
      selectionLabels: computeSelectionLabels(
        scene.plants,
        selectionLabelPlantIds,
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
    const plantNamesRevision = this._notePreparedPlantNames(labelsChanged)
    try {
      const loaded = await this._speciesCache.ensureEntries(canonicalNames, activeLocale)
      const backfills = this.derivePresentationBackfills()
      return {
        changed: labelsChanged || loaded || backfills !== null,
        plantNamesRevision,
        backfills,
        failure: null,
      }
    } catch (error) {
      return {
        changed: labelsChanged,
        plantNamesRevision,
        backfills: null,
        failure: { error },
      }
    }
  }

  async refreshCurrentPresentationData(): Promise<ScenePresentationRefreshResult> {
    const plants = this._sceneStore.persisted.plants
    const canonicalNames = [...new Set(plants.map((plant) => plant.canonicalName))]
    if (canonicalNames.length === 0) {
      return {
        changed: false,
        plantNamesRevision: this._preparedPlantNamesRevision,
        backfills: null,
        failure: null,
      }
    }

    const labelsChanged = await this._plantLabels.ensureEntries(canonicalNames, this._getLocale())
    const plantNamesRevision = this._notePreparedPlantNames(labelsChanged)

    const needsSpeciesCache = plants.some((plant) => plant.stratum === null || plant.canopySpreadM === null)
    if (!needsSpeciesCache) {
      return {
        changed: labelsChanged,
        plantNamesRevision,
        backfills: null,
        failure: null,
      }
    }

    try {
      const loaded = await this._speciesCache.ensureEntries(canonicalNames, this._getLocale())
      const backfills = this.derivePresentationBackfills()
      return {
        changed: labelsChanged || loaded || backfills !== null,
        plantNamesRevision,
        backfills,
        failure: null,
      }
    } catch (error) {
      return {
        changed: labelsChanged,
        plantNamesRevision,
        backfills: null,
        failure: { error },
      }
    }
  }

  publishRefresh(result: ScenePresentationRefreshResult): boolean {
    if (result.plantNamesRevision <= this._publishedPlantNamesRevision) return false
    this._publishedPlantNamesRevision = result.plantNamesRevision
    this._onPlantNamesChanged()
    return true
  }

  private _notePreparedPlantNames(changed: boolean): number {
    if (changed) this._preparedPlantNamesRevision += 1
    return this._preparedPlantNamesRevision
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
        canonicalName: plant.canonicalName,
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
  target: SceneDesignObjectTarget | null,
): SceneRendererHoverTarget | null {
  if (!target || !containsHoverTarget(scene, target)) return null
  const layerLocked = isHoverTargetLayerLocked(scene, target)
  const state = layerLocked
    ? 'locked-layer'
    : isSceneDesignObjectLocked(scene, target)
      ? 'locked-design-object'
      : 'hover'
  return { ...target, state }
}

function containsHoverTarget(
  scene: ScenePersistedState,
  target: SceneDesignObjectTarget,
): boolean {
  if (target.kind === 'group') return scene.groups.some((group) => group.id === target.id)
  if (target.kind === 'plant') return scene.plants.some((plant) => plant.id === target.id)
  if (target.kind === 'zone') return scene.zones.some((zone) => zone.name === target.id)
  if (target.kind === 'annotation') {
    return scene.annotations.some((annotation) => annotation.id === target.id)
  }
  return scene.measurementGuides.some((guide) => guide.id === target.id)
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
