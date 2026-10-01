// canvas/runtime/tools/spatial-index.ts
//
// Owns createToolScene: the ToolScene tools and the ToolHost query (spec §1.2a, §1.4). In 0B it is a façade over today's
// linear hit tests (hit-testing.ts) at the frame's pixelsPerMetre, read at every query; nothing is cached, and
// an index is later work (INV-TOOL-24). hitAt without a filter is hitTestTopLevel exactly, object locks included (the tool
// rejects them); `includeLocked` is hitTestVisibleTopLevel (the host's hover). nearestPlant is today's Place plants scan
// (interaction/plant-placement-preview.ts): the first plant in scene order wins a tie. tools/tool-host.ts re-exports the
// factory.

import { computeQuadBoundsRect } from '../../operations'
import type { ToolSceneSource } from '../interaction-ports'
import { buildPlantPresentationEntries, type PlantPresentationContext } from '../plant-presentation'
import type { SceneDesignObjectTarget } from '../scene/design-object-targets'
import type { ScenePersistedState, ScenePlantEntity } from '../scene/types'
import type { WorldPoint, WorldQuad } from '../view/types'
import { hitTestTopLevel, hitTestVisibleTopLevel, queryRectTopLevel } from './hit-testing'
import type { HitFilter, HitTarget, ToolScene } from './tool'

export function createToolScene(source: ToolSceneSource): ToolScene {
  const persisted = (): ScenePersistedState => source.store.persisted

  function plantContext(pixelsPerMetre: number): PlantPresentationContext {
    return { ...source.plantContext(pixelsPerMetre), speciesCache: source.speciesCache() }
  }

  return {
    get persisted() {
      return persisted()
    },
    hitAt(world: WorldPoint, filter?: HitFilter): HitTarget | null {
      refuseScreenTolerance(filter)
      const hitTest = filter?.includeLocked ? hitTestVisibleTopLevel : hitTestTopLevel
      const hit = hitTest(
        persisted(),
        world,
        source.pixelsPerMetre(),
        source.speciesCache(),
        source.plantContext,
        source.selection(),
        source.store.session.hoveredTarget,
      )
      return hit && acceptsKind(filter, hit) ? { kind: 'object', target: hit } : null
    },
    hitInQuad(quad: WorldQuad, filter?: HitFilter): readonly HitTarget[] {
      refuseScreenTolerance(filter)
      if (filter?.includeLocked) {
        throw new Error('ToolScene.hitInQuad has no includeLocked query: today\'s band select skips locked layers.')
      }
      return queryRectTopLevel(
        persisted(),
        computeQuadBoundsRect(quad),
        source.pixelsPerMetre(),
        source.speciesCache(),
        source.plantContext,
        source.selection(),
      )
        .filter((target) => acceptsKind(filter, target))
        .map((target) => ({ kind: 'object', target }))
    },
    nearestPlant(world: WorldPoint, excluding?: ReadonlySet<string>) {
      const scene = persisted()
      if (scene.layers.find((layer) => layer.name === 'plants')?.visible === false) return null
      let best: { plant: ScenePlantEntity; distanceM: number } | null = null
      for (const plant of scene.plants) {
        if (excluding?.has(plant.id)) continue
        const distanceM = Math.hypot(plant.position.x - world.x, plant.position.y - world.y)
        if (!best || distanceM < best.distanceM) best = { plant, distanceM }
      }
      return best
    },
    plantPresentation(plant: ScenePlantEntity | string) {
      const entity = typeof plant === 'string' ? speciesPlant(plant) : plant
      if (!entity) return null
      const scene = persisted()
      const context = plantContext(source.pixelsPerMetre())
      const entry = buildPlantPresentationEntries(
        [entity],
        { ...context, plants: typeof plant === 'string' ? [] : scene.plants },
        new Set(),
      )[0]!
      return {
        commonName: context.localizedCommonNames?.get(entity.canonicalName) ?? entity.commonName ?? entity.canonicalName,
        color: entry.color,
        radiusPx: entry.radiusScreenPx,
      }
    },
    isLayerOpenForCreation: (layer) => source.isLayerOpenForCreation(layer),
    selection: () => source.selection(),
    selectionModel: () => source.selectionModel(),
  }
}

function acceptsKind(filter: HitFilter | undefined, target: SceneDesignObjectTarget): boolean {
  return !filter?.kinds || filter.kinds.includes(target.kind)
}

/**
 * Today's hit tests carry their own tolerances (6 px for zone and guide lines, 4 px around a plant). A caller's screen
 * tolerance belongs to the zone-edge hits of "Turn view to this edge" (phase 1), which 0B does not answer.
 */
function refuseScreenTolerance(filter: HitFilter | undefined): void {
  if (filter?.toleranceScreenPx !== undefined) {
    throw new Error('ToolScene hit tests take no toleranceScreenPx before the zone-edge hits of phase 1.')
  }
}

/** A species the scene has not placed: its presentation as a plant with nothing stored beyond its name. */
function speciesPlant(canonicalName: string): ScenePlantEntity | null {
  if (canonicalName.length === 0) return null
  return {
    kind: 'plant',
    id: '',
    locked: false,
    canonicalName,
    commonName: null,
    color: null,
    stratum: null,
    canopySpreadM: null,
    position: { x: 0, y: 0 },
    rotationDeg: null,
    notes: null,
    plantedDate: null,
    quantity: 1,
  }
}
