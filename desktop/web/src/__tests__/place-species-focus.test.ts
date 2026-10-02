import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { focusOwner } from '../app/keyboard/focus-owner'
import { placeSpeciesOnMap } from '../components/plant-db/place-species'
import { clearPlantStampSource, readPlantStampSource } from '../canvas/plant-stamp-source'

// Esc cancels Place plants only when the key comes from the map (the canvas
// ignores Esc from panel buttons on purpose), so every Place button hands
// focus to the map surface after arming the tool (canopi-agjl).
describe('Place moves focus to the map so Esc reaches the armed tool', () => {
  let map: HTMLElement
  let mapControl: HTMLButtonElement
  let placeButton: HTMLButtonElement
  let release: () => void

  beforeEach(() => {
    map = document.createElement('div')
    map.tabIndex = 0
    map.innerHTML = '<button>Zoom in</button>'
    mapControl = map.querySelector('button')!
    placeButton = document.createElement('button')
    document.body.append(map, placeButton)
    release = focusOwner.registerRegion('map', map)
  })

  afterEach(() => {
    release()
    clearPlantStampSource()
    document.body.innerHTML = ''
  })

  it('focuses the map surface itself, not the control last used inside it', () => {
    mapControl.focus()
    placeButton.focus()
    focusOwner.focusMap('tool-armed')
    expect(document.activeElement).toBe(map)
  })

  it('arms Place plants with the species and focuses the map', () => {
    const setTool = vi.fn()
    placeButton.focus()
    placeSpeciesOnMap({ canonical_name: 'Corylus avellana', common_name: 'European hazelnut', stratum: null, width_max_m: null }, { setTool })
    expect(setTool).toHaveBeenCalledWith('plant-stamp')
    expect(readPlantStampSource()?.canonical_name).toBe('Corylus avellana')
    expect(document.activeElement).toBe(map)
  })

  it('leaves focus alone when there is no canvas to place on', () => {
    placeButton.focus()
    placeSpeciesOnMap({ canonical_name: 'Corylus avellana', common_name: 'European hazelnut', stratum: null, width_max_m: null }, null)
    expect(document.activeElement).toBe(placeButton)
  })
})
