import { beforeEach, describe, expect, it } from 'vitest'
import { currentDesign, nonCanvasRevision } from '../state/design'
import {
  clearDesignLocation,
  saveLocationDraft,
  selectSearchResultLocation,
  setDesignLocation,
} from '../app/location/controller'

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

  it('saves a validated location draft through the action boundary', () => {
    const saved = saveLocationDraft({ lat: '48.8566', lon: '2.3522', altitude: '35' })

    expect(saved).toBe(true)
    expect(currentDesign.value?.location).toEqual({ lat: 48.8566, lon: 2.3522, altitude_m: 35 })
    expect(nonCanvasRevision.value).toBe(1)
  })

  it('ignores invalid location drafts without mutating the design', () => {
    const saved = saveLocationDraft({ lat: '91', lon: '2.3522', altitude: '' })

    expect(saved).toBe(false)
    expect(currentDesign.value?.location).toBe(null)
    expect(nonCanvasRevision.value).toBe(0)
  })

  it('commits a selected geocode result while preserving empty altitude as null', () => {
    const saved = selectSearchResultLocation({ lat: 48.8566, lon: 2.3522 }, '')

    expect(saved).toBe(true)
    expect(currentDesign.value?.location).toEqual({ lat: 48.8566, lon: 2.3522, altitude_m: null })
    expect(nonCanvasRevision.value).toBe(1)
  })
})
