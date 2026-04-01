import { beforeEach, describe, expect, it } from 'vitest'
import { designLocation } from '../state/canvas'
import { currentDesign, nonCanvasRevision } from '../state/design'
import { clearDesignLocation, setDesignLocation } from '../state/location-actions'

beforeEach(() => {
  nonCanvasRevision.value = 0
  designLocation.value = null
  currentDesign.value = {
    version: 1,
    name: 'test',
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    created_at: '',
    updated_at: '',
  }
})

describe('location actions', () => {
  it('sets the design location through the action boundary', () => {
    setDesignLocation({ lat: 48.8566, lon: 2.3522, altitude_m: 35 })

    expect(currentDesign.value?.location).toEqual({ lat: 48.8566, lon: 2.3522, altitude_m: 35 })
    expect(designLocation.value).toEqual({ lat: 48.8566, lon: 2.3522 })
    expect(nonCanvasRevision.value).toBe(1)
  })

  it('clears the design location and its canvas mirror', () => {
    setDesignLocation({ lat: 48.8566, lon: 2.3522, altitude_m: null })

    clearDesignLocation()

    expect(currentDesign.value?.location).toBe(null)
    expect(designLocation.value).toBe(null)
    expect(nonCanvasRevision.value).toBe(2)
  })
})
