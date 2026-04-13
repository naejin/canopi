import { computeSelectionLabels } from '../selection-labels'
import { CanvasPlantLabelResolver } from '../plant-labels'
import {
  resolvePlantCanopySpreadM,
  resolvePlantStratum,
  type PlantPresentationContext,
} from '../plant-presentation'
import { CanvasSpeciesCache } from '../species-cache'
import type { SceneRendererSnapshot } from '../renderers/scene-types'
import type { ScenePersistedState, SceneStore, SceneViewportState } from '../scene'
import {
  getSelectedAnnotationIds,
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
  private readonly _speciesCache = new CanvasSpeciesCache()
  private readonly _plantLabels = new CanvasPlantLabelResolver()

  constructor(options: SceneRuntimePresentationControllerOptions) {
    this._sceneStore = options.sceneStore
    this._getViewport = options.getViewport
    this._getLocale = options.getLocale
    this._resolveHighlightedTargets = options.resolveHighlightedTargets
    this._onPlantNamesChanged = options.onPlantNamesChanged
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
    const session = this._sceneStore.session
    return {
      viewport: {
        x: 0,
        y: 0,
        scale: viewportScale,
      },
      sizeMode: session.plantSizeMode,
      colorByAttr: session.plantColorByAttr,
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

    return {
      scene,
      viewport: this._getViewport(),
      selectedPlantIds: getSelectedPlantIds(scene, session.selectedEntityIds),
      selectedZoneIds: getSelectedZoneIds(scene, session.selectedEntityIds),
      selectedAnnotationIds: getSelectedAnnotationIds(scene, session.selectedEntityIds),
      highlightedPlantIds: new Set(highlightedTargets.plantIds),
      highlightedZoneIds: new Set(highlightedTargets.zoneIds),
      sizeMode: session.plantSizeMode,
      colorByAttr: session.plantColorByAttr,
      speciesCache: this._speciesCache.getCache(),
      localizedCommonNames,
      hoveredCanonicalName: hoveredPlant?.canonicalName ?? null,
      selectionLabels: computeSelectionLabels(
        scene.plants,
        session.selectedEntityIds,
        this._getViewport(),
        localizedCommonNames,
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
    const session = this._sceneStore.session
    const plants = this._sceneStore.persisted.plants
    const canonicalNames = [...new Set(plants.map((plant) => plant.canonicalName))]
    if (canonicalNames.length === 0) {
      return { changed: false, backfills: null }
    }

    const labelsChanged = await this._plantLabels.ensureEntries(canonicalNames, this._getLocale())
    if (labelsChanged) this._onPlantNamesChanged()

    const needsSpeciesCache =
      session.plantColorByAttr !== null
      || session.plantSizeMode === 'canopy'
      || plants.some((plant) => plant.stratum === null || plant.canopySpreadM === null)
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
