import { beforeEach, describe, expect, it } from 'vitest'
import {
  designSessionFixture,
  currentDesign,
  nonCanvasRevision,
} from './support/design-session-state'
import {
  clearDesignLocation,
  setDesignLocation,
} from '../app/location/controller'

beforeEach(() => {
  designSessionFixture.nonCanvasRevision = 0
  designSessionFixture.file = {
    version: 6,
    name: 'test',
    description: null,
    spatial_frame: { anchor_longitude_deg: 13, anchor_latitude_deg: 23, north_bearing_deg: 0, placement_status: 'provisional', location_metadata: { altitude_m: null } },
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '',
    updated_at: '',
    extra: {},
  }
})

describe('location actions', () => {
  it('sets the design location through the action boundary', () => {
    setDesignLocation({ lat: 48.8566, lon: 2.3522, altitude_m: 35 })

    expect(currentDesign.value?.spatial_frame).toEqual({
      anchor_longitude_deg: 2.3522,
      anchor_latitude_deg: 48.8566,
      north_bearing_deg: 0,
      placement_status: 'confirmed',
      location_metadata: { altitude_m: 35 },
    })
    expect(nonCanvasRevision.value).toBe(1)
  })

  it('clears the design location', () => {
    setDesignLocation({ lat: 48.8566, lon: 2.3522, altitude_m: null })

    clearDesignLocation()

    expect(currentDesign.value?.spatial_frame).toEqual({
      anchor_longitude_deg: 13,
      anchor_latitude_deg: 23,
      north_bearing_deg: 0,
      placement_status: 'provisional',
      location_metadata: { altitude_m: null },
    })
    expect(nonCanvasRevision.value).toBe(2)
  })
})
