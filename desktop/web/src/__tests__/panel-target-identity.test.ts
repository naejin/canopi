import { beforeEach, describe, expect, it } from 'vitest'
import { hoveredPanelTargets, selectedPanelTargets } from '../app/panel-targets/state'
import {
  MANUAL_TARGET,
  NONE_TARGET,
  panelTargets,
  type PanelTargetMapProjectionScene,
} from '../panel-targets'
import type { PanelTarget } from '../types/design'

const LOCATION = { lat: 48.8566, lon: 2.3522 }

function createScene(overrides: Partial<PanelTargetMapProjectionScene> = {}): PanelTargetMapProjectionScene {
  return {
    plants: [
      { id: 'plant-1', canonicalName: 'Malus domestica', position: { x: 0, y: 0 } },
      { id: 'plant-2', canonicalName: 'Prunus avium', position: { x: 12, y: -6 } },
      { id: 'plant-3', canonicalName: 'Malus domestica', position: { x: 10, y: 20 } },
    ],
    zones: [
      {
        name: 'orchard',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      },
    ],
    ...overrides,
  }
}

describe('panelTargets identity seam', () => {
  beforeEach(() => {
    hoveredPanelTargets.value = []
    selectedPanelTargets.value = []
  })

  it('centralizes constructors, keys, equality, and list equality', () => {
    const species = panelTargets.species('Malus domestica')
    const sameSpecies = panelTargets.species('Malus domestica')
    const otherSpecies = panelTargets.species('Prunus avium')

    expect(species).toEqual({ kind: 'species', canonical_name: 'Malus domestica' })
    expect(panelTargets.key(species)).toBe('species:Malus domestica')
    expect(panelTargets.key({ kind: 'placed_plant', plant_id: 'plant-1' })).toBe('placed_plant:plant-1')
    expect(panelTargets.key({ kind: 'zone', zone_name: 'orchard' })).toBe('zone:orchard')
    expect(panelTargets.key(MANUAL_TARGET)).toBe('manual')
    expect(panelTargets.key(NONE_TARGET)).toBe('none')

    expect(panelTargets.equals(species, sameSpecies)).toBe(true)
    expect(panelTargets.equals(species, otherSpecies)).toBe(false)
    expect(panelTargets.listEquals([species, MANUAL_TARGET], [sameSpecies, MANUAL_TARGET])).toBe(true)
    expect(panelTargets.listEquals([species, MANUAL_TARGET], [MANUAL_TARGET, sameSpecies])).toBe(false)
  })

  it('resolves scene-backed targets and projects map features through the same resolution', () => {
    const missingSpecies = panelTargets.species('Pyrus communis')
    const missingPlant: PanelTarget = { kind: 'placed_plant', plant_id: 'missing-plant' }
    const missingZone: PanelTarget = { kind: 'zone', zone_name: 'missing-zone' }
    const index = panelTargets.indexScene(createScene())

    const resolution = panelTargets.resolve(
      [
        panelTargets.species('Malus domestica'),
        { kind: 'placed_plant', plant_id: 'plant-2' },
        { kind: 'zone', zone_name: 'orchard' },
        MANUAL_TARGET,
        NONE_TARGET,
        missingSpecies,
        missingPlant,
        missingZone,
      ],
      index,
    )
    const projection = resolution.toMapFeatures(LOCATION)

    expect(resolution.plantIds).toEqual(['plant-1', 'plant-3', 'plant-2'])
    expect(resolution.zoneIds).toEqual(['orchard'])
    expect(resolution.sceneIds).toEqual(['plant-1', 'plant-3', 'plant-2', 'orchard'])
    expect(resolution.unresolvedTargets).toEqual([missingSpecies, missingPlant, missingZone])
    expect(projection.features.map((feature) => feature.properties)).toEqual([
      { kind: 'plant', sceneId: 'plant-1' },
      { kind: 'plant', sceneId: 'plant-3' },
      { kind: 'plant', sceneId: 'plant-2' },
      { kind: 'zone', sceneId: 'orchard' },
    ])
    expect(projection.unresolvedTargets).toEqual(resolution.unresolvedTargets)
    expect(projection.skippedSceneIds).toEqual([])
    expect(projection.skippedReason).toBeNull()
  })

  it('deduplicates resolved scene IDs and map features while preserving first discovery order', () => {
    const resolution = panelTargets.resolve(
      [
        { kind: 'placed_plant', plant_id: 'plant-3' },
        panelTargets.species('Malus domestica'),
        { kind: 'placed_plant', plant_id: 'plant-1' },
        { kind: 'zone', zone_name: 'orchard' },
        { kind: 'zone', zone_name: 'orchard' },
      ],
      panelTargets.indexScene(createScene()),
    )

    expect(resolution.plantIds).toEqual(['plant-3', 'plant-1'])
    expect(resolution.zoneIds).toEqual(['orchard'])
    expect(resolution.sceneIds).toEqual(['plant-3', 'plant-1', 'orchard'])
    expect(resolution.toMapFeatures(LOCATION).features.map((feature) => feature.properties)).toEqual([
      { kind: 'plant', sceneId: 'plant-3' },
      { kind: 'plant', sceneId: 'plant-1' },
      { kind: 'zone', sceneId: 'orchard' },
    ])
  })

  it('reports unresolved targets without mutating panel hover or selection state', () => {
    const hovered = [panelTargets.species('Hovered')]
    const selected = [panelTargets.species('Selected')]
    hoveredPanelTargets.value = hovered
    selectedPanelTargets.value = selected

    const resolution = panelTargets.resolve(
      [
        panelTargets.species('Missing species'),
        { kind: 'placed_plant', plant_id: 'missing-plant' },
        { kind: 'zone', zone_name: 'missing-zone' },
      ],
      panelTargets.indexScene(createScene()),
    )

    expect(resolution.plantIds).toEqual([])
    expect(resolution.zoneIds).toEqual([])
    expect(resolution.sceneIds).toEqual([])
    expect(resolution.unresolvedTargets).toEqual([
      panelTargets.species('Missing species'),
      { kind: 'placed_plant', plant_id: 'missing-plant' },
      { kind: 'zone', zone_name: 'missing-zone' },
    ])
    expect(hoveredPanelTargets.value).toBe(hovered)
    expect(selectedPanelTargets.value).toBe(selected)
  })
})
