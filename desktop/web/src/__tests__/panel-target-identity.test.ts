import { beforeEach, describe, expect, it } from 'vitest'
import { hoveredPanelTargets, selectedPanelTargets } from '../app/panel-targets/state'
import {
  MANUAL_TARGET,
  NONE_TARGET,
  panelTargetIdentity,
  type PanelTargetSceneInput,
} from '../panel-target-identity'
import type { PanelTarget } from '../types/design'

function createScene(overrides: Partial<PanelTargetSceneInput> = {}): PanelTargetSceneInput {
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
    const species = panelTargetIdentity.species('Malus domestica')
    const sameSpecies = panelTargetIdentity.species('Malus domestica')
    const otherSpecies = panelTargetIdentity.species('Prunus avium')

    expect(species).toEqual({ kind: 'species', canonical_name: 'Malus domestica' })
    expect(panelTargetIdentity.key(species)).toBe('species:Malus domestica')
    expect(panelTargetIdentity.key({ kind: 'placed_plant', plant_id: 'plant-1' })).toBe('placed_plant:plant-1')
    expect(panelTargetIdentity.key({ kind: 'zone', zone_name: 'orchard' })).toBe('zone:orchard')
    expect(panelTargetIdentity.key(MANUAL_TARGET)).toBe('manual')
    expect(panelTargetIdentity.key(NONE_TARGET)).toBe('none')

    expect(panelTargetIdentity.equals(species, sameSpecies)).toBe(true)
    expect(panelTargetIdentity.equals(species, otherSpecies)).toBe(false)
    expect(panelTargetIdentity.listEquals([species, MANUAL_TARGET], [sameSpecies, MANUAL_TARGET])).toBe(true)
    expect(panelTargetIdentity.listEquals([species, MANUAL_TARGET], [MANUAL_TARGET, sameSpecies])).toBe(false)
  })

  it('resolves scene-backed targets without owning map projection', () => {
    const missingSpecies = panelTargetIdentity.species('Pyrus communis')
    const missingPlant: PanelTarget = { kind: 'placed_plant', plant_id: 'missing-plant' }
    const missingZone: PanelTarget = { kind: 'zone', zone_name: 'missing-zone' }
    const index = panelTargetIdentity.indexScene(createScene())

    const resolution = panelTargetIdentity.resolve(
      [
        panelTargetIdentity.species('Malus domestica'),
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

    expect(resolution.plantIds).toEqual(['plant-1', 'plant-3', 'plant-2'])
    expect(resolution.zoneIds).toEqual(['orchard'])
    expect(resolution.sceneIds).toEqual(['plant-1', 'plant-3', 'plant-2', 'orchard'])
    expect(resolution.unresolvedTargets).toEqual([missingSpecies, missingPlant, missingZone])
    expect(resolution.resolvedRefs.map((ref) => ({ kind: ref.kind, id: ref.id }))).toEqual([
      { kind: 'plant', id: 'plant-1' },
      { kind: 'plant', id: 'plant-3' },
      { kind: 'plant', id: 'plant-2' },
      { kind: 'zone', id: 'orchard' },
    ])
    expect('toMapFeatures' in resolution).toBe(false)
  })

  it('deduplicates resolved scene refs while preserving first discovery order', () => {
    const resolution = panelTargetIdentity.resolve(
      [
        { kind: 'placed_plant', plant_id: 'plant-3' },
        panelTargetIdentity.species('Malus domestica'),
        { kind: 'placed_plant', plant_id: 'plant-1' },
        { kind: 'zone', zone_name: 'orchard' },
        { kind: 'zone', zone_name: 'orchard' },
      ],
      panelTargetIdentity.indexScene(createScene()),
    )

    expect(resolution.plantIds).toEqual(['plant-3', 'plant-1'])
    expect(resolution.zoneIds).toEqual(['orchard'])
    expect(resolution.sceneIds).toEqual(['plant-3', 'plant-1', 'orchard'])
    expect(resolution.resolvedRefs.map((ref) => ({ kind: ref.kind, id: ref.id }))).toEqual([
      { kind: 'plant', id: 'plant-3' },
      { kind: 'plant', id: 'plant-1' },
      { kind: 'zone', id: 'orchard' },
    ])
  })

  it('reports unresolved targets without mutating panel hover or selection state', () => {
    const hovered = [panelTargetIdentity.species('Hovered')]
    const selected = [panelTargetIdentity.species('Selected')]
    hoveredPanelTargets.value = hovered
    selectedPanelTargets.value = selected

    const resolution = panelTargetIdentity.resolve(
      [
        panelTargetIdentity.species('Missing species'),
        { kind: 'placed_plant', plant_id: 'missing-plant' },
        { kind: 'zone', zone_name: 'missing-zone' },
      ],
      panelTargetIdentity.indexScene(createScene()),
    )

    expect(resolution.plantIds).toEqual([])
    expect(resolution.zoneIds).toEqual([])
    expect(resolution.sceneIds).toEqual([])
    expect(resolution.unresolvedTargets).toEqual([
      panelTargetIdentity.species('Missing species'),
      { kind: 'placed_plant', plant_id: 'missing-plant' },
      { kind: 'zone', zone_name: 'missing-zone' },
    ])
    expect(hoveredPanelTargets.value).toBe(hovered)
    expect(selectedPanelTargets.value).toBe(selected)
  })
})
