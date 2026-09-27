import { afterEach, describe, expect, it } from 'vitest'
import { clearSpeciesDetailOnMap, showSpeciesDetailOnMap } from '../app/plant-finder/map-matches'
import { selectedPanelTargetOrigin, selectedPanelTargets } from '../app/panel-targets/state'
import { setSelectedPanelTargets } from '../app/panel-targets/presentation'
import { speciesTarget } from '../target'

afterEach(() => {
  selectedPanelTargets.value = []
  selectedPanelTargetOrigin.value = null
})

describe('species detail map highlight', () => {
  it('rings the open species on the map and clears only its own highlight', () => {
    showSpeciesDetailOnMap('Castanea sativa')
    expect(selectedPanelTargets.value).toEqual([speciesTarget('Castanea sativa')])
    expect(selectedPanelTargetOrigin.value).toBe('species-detail')

    clearSpeciesDetailOnMap()
    expect(selectedPanelTargets.value).toEqual([])
  })

  it('leaves another panel\'s selection alone when the detail closes', () => {
    setSelectedPanelTargets('consortium', [speciesTarget('Malus domestica')])
    clearSpeciesDetailOnMap()
    expect(selectedPanelTargets.value).toEqual([speciesTarget('Malus domestica')])
  })
})
