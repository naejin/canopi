import { describe, expect, it } from 'vitest'
import { MANUAL_TARGET, NONE_TARGET, speciesTarget } from '../panel-targets'
import { resolvePanelTargets, type PanelTargetResolutionScene } from '../panel-target-resolution'
import type { PanelTarget } from '../types/design'

function createScene(overrides: Partial<PanelTargetResolutionScene> = {}): PanelTargetResolutionScene {
  return {
    plants: [
      { id: 'plant-1', canonicalName: 'Malus domestica' },
      { id: 'plant-2', canonicalName: 'Prunus avium' },
      { id: 'plant-3', canonicalName: 'Malus domestica' },
    ],
    zones: [
      { name: 'orchard' },
      { name: 'pond-edge' },
    ],
    ...overrides,
  }
}

describe('resolvePanelTargets', () => {
  it('resolves a species target to all matching placed plants in scene order', () => {
    const result = resolvePanelTargets([speciesTarget('Malus domestica')], createScene())

    expect(result).toEqual({
      sceneIds: ['plant-1', 'plant-3'],
      unresolvedTargets: [],
    })
  })

  it('resolves a placed plant target only when the plant ID exists', () => {
    const target: PanelTarget = { kind: 'placed_plant', plant_id: 'plant-2' }

    const result = resolvePanelTargets([target], createScene())

    expect(result).toEqual({
      sceneIds: ['plant-2'],
      unresolvedTargets: [],
    })
  })

  it('resolves a zone target by zone name', () => {
    const target: PanelTarget = { kind: 'zone', zone_name: 'orchard' }

    const result = resolvePanelTargets([target], createScene())

    expect(result).toEqual({
      sceneIds: ['orchard'],
      unresolvedTargets: [],
    })
  })

  it('treats manual and none targets as intentionally empty', () => {
    const result = resolvePanelTargets([MANUAL_TARGET, NONE_TARGET], createScene())

    expect(result).toEqual({
      sceneIds: [],
      unresolvedTargets: [],
    })
  })

  it('resolves mixed targets and reports only missing scene-backed targets', () => {
    const missingSpecies = speciesTarget('Pyrus communis')
    const missingPlant: PanelTarget = { kind: 'placed_plant', plant_id: 'plant-missing' }
    const missingZone: PanelTarget = { kind: 'zone', zone_name: 'missing-zone' }

    const result = resolvePanelTargets(
      [
        speciesTarget('Malus domestica'),
        { kind: 'placed_plant', plant_id: 'plant-2' },
        { kind: 'zone', zone_name: 'pond-edge' },
        MANUAL_TARGET,
        NONE_TARGET,
        missingSpecies,
        missingPlant,
        missingZone,
      ],
      createScene(),
    )

    expect(result).toEqual({
      sceneIds: ['plant-1', 'plant-3', 'plant-2', 'pond-edge'],
      unresolvedTargets: [missingSpecies, missingPlant, missingZone],
    })
  })

  it('deduplicates scene IDs while preserving first discovery order', () => {
    const result = resolvePanelTargets(
      [
        { kind: 'placed_plant', plant_id: 'plant-3' },
        speciesTarget('Malus domestica'),
        { kind: 'placed_plant', plant_id: 'plant-1' },
      ],
      createScene(),
    )

    expect(result).toEqual({
      sceneIds: ['plant-3', 'plant-1'],
      unresolvedTargets: [],
    })
  })
})
