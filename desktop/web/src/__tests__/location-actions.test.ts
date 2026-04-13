import { beforeEach, describe, expect, it } from 'vitest'
import { currentDesign, nonCanvasRevision } from '../state/design'
import { clearDesignLocation, setDesignLocation } from '../app/location/controller'

beforeEach(() => {
  nonCanvasRevision.value = 0
  currentDesign.value = {
    version: 1,
    name: 'test',
    description: null,
    location: null,
    north_bearing_deg: null,
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    created_at: '',
    updated_at: '',
    extra: {},
  }
})

describe('location actions', () => {
  it('sets the design location through the action boundary', () => {
    setDesignLocation({ lat: 48.8566, lon: 2.3522, altitude_m: 35 })

    expect(currentDesign.value?.location).toEqual({ lat: 48.8566, lon: 2.3522, altitude_m: 35 })
    expect(nonCanvasRevision.value).toBe(1)
  })

  it('clears the design location', () => {
    setDesignLocation({ lat: 48.8566, lon: 2.3522, altitude_m: null })

    clearDesignLocation()

    expect(currentDesign.value?.location).toBe(null)
    expect(nonCanvasRevision.value).toBe(2)
  })
})
