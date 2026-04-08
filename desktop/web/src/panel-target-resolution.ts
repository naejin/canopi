import type { PanelTarget } from './types/design'

export interface PanelTargetResolutionScene {
  readonly plants: readonly {
    readonly id: string
    readonly canonicalName: string
  }[]
  readonly zones: readonly {
    readonly name: string
  }[]
}

export interface PanelTargetResolutionResult {
  readonly plantIds: string[]
  readonly zoneIds: string[]
  readonly sceneIds: string[]
  readonly unresolvedTargets: PanelTarget[]
}

export function resolvePanelTargets(
  targets: readonly PanelTarget[],
  scene: PanelTargetResolutionScene,
): PanelTargetResolutionResult {
  const seenIds = new Set<string>()
  const sceneIds: string[] = []
  const plantIds: string[] = []
  const zoneIds: string[] = []
  const unresolvedTargets: PanelTarget[] = []

  const addSceneId = (id: string): void => {
    if (seenIds.has(id)) return
    seenIds.add(id)
    sceneIds.push(id)
  }

  const addPlantId = (id: string): void => {
    if (!plantIds.includes(id)) plantIds.push(id)
    addSceneId(id)
  }

  const addZoneId = (id: string): void => {
    if (!zoneIds.includes(id)) zoneIds.push(id)
    addSceneId(id)
  }

  for (const target of targets) {
    switch (target.kind) {
      case 'species': {
        let matched = false
        for (const plant of scene.plants) {
          if (plant.canonicalName !== target.canonical_name) continue
          matched = true
          addPlantId(plant.id)
        }
        if (!matched) unresolvedTargets.push(target)
        break
      }
      case 'placed_plant': {
        const plant = scene.plants.find((entry) => entry.id === target.plant_id)
        if (plant) addPlantId(plant.id)
        else unresolvedTargets.push(target)
        break
      }
      case 'zone': {
        const zone = scene.zones.find((entry) => entry.name === target.zone_name)
        if (zone) addZoneId(zone.name)
        else unresolvedTargets.push(target)
        break
      }
      case 'manual':
      case 'none':
        break
    }
  }

  return { plantIds, zoneIds, sceneIds, unresolvedTargets }
}
