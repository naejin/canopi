import { beforeEach, describe, expect, it } from 'vitest'
import {
  designSessionFixture,
  currentDesign,
  nonCanvasRevision,
} from './support/design-session-state'
import {
  beginDesignPlacementEdit,
} from '../app/location/controller'
import { designEditAuthorityCapability } from '../app/design-edit/authority-capability'
import { editCurrentDesign } from '../app/design-edit'
import { designSessionStore } from '../app/document-session/store'
import { createDesignSessionPersistence } from '../app/document-session/persistence'
import { confirmedSpatialFrame, newDesignSpatialFrame } from '../spatial-frame'

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
  it('previews and commits one spatial placement through the action boundary', () => {
    const persistence = createDesignSessionPersistence({ store: designSessionStore })
    const edit = beginDesignPlacementEdit()
    edit.preview(confirmedSpatialFrame(edit.original, {
      lat: 48.8566,
      lon: 2.3522,
      altitude_m: 35,
    }))

    expect(currentDesign.value?.spatial_frame).toEqual({
      anchor_longitude_deg: 2.3522,
      anchor_latitude_deg: 48.8566,
      north_bearing_deg: 0,
      placement_status: 'confirmed',
      location_metadata: { altitude_m: 35 },
    })
    expect(nonCanvasRevision.value).toBe(0)
    expect(persistence.captureObservation(null)?.spatial_frame.placement_status).toBe('provisional')

    expect(edit.commit()).toEqual({ status: 'committed', changed: true })
    expect(nonCanvasRevision.value).toBe(1)
    persistence.dispose()
  })

  it('records reset-to-provisional for undo and redo without changing other fields', () => {
    designSessionFixture.file = {
      ...currentDesign.value!,
      description: 'preserve me',
      spatial_frame: {
        anchor_longitude_deg: 2.3522,
        anchor_latitude_deg: 48.8566,
        north_bearing_deg: 14,
        placement_status: 'confirmed',
        location_metadata: { altitude_m: 35 },
      },
    }
    const edit = beginDesignPlacementEdit()
    edit.preview(newDesignSpatialFrame())
    edit.commit()

    editCurrentDesign((design) => ({
      ...design,
      description: 'later document edit',
      lidar: {
        schema_version: 1,
        entries: [{
          kind: 'Source',
          id: 'source-1',
          visible: false,
          opacity: 1,
          order: 0,
          style: null,
        }],
      },
    }))

    const history = designEditAuthorityCapability(designSessionStore).history
    expect(history.canUndo.value).toBe(true)
    expect(history.undo()).toBe(true)
    expect(currentDesign.value?.spatial_frame).toEqual({
      anchor_longitude_deg: 2.3522,
      anchor_latitude_deg: 48.8566,
      north_bearing_deg: 14,
      placement_status: 'confirmed',
      location_metadata: { altitude_m: 35 },
    })
    expect(currentDesign.value?.description).toBe('later document edit')
    expect(currentDesign.value?.lidar?.entries[0]?.id).toBe('source-1')

    expect(history.redo()).toBe(true)
    expect(currentDesign.value?.spatial_frame).toEqual({
      anchor_longitude_deg: 13,
      anchor_latitude_deg: 23,
      north_bearing_deg: 0,
      placement_status: 'provisional',
      location_metadata: { altitude_m: null },
    })
    expect(currentDesign.value?.description).toBe('later document edit')
    expect(currentDesign.value?.lidar?.entries[0]?.id).toBe('source-1')
    expect(nonCanvasRevision.value).toBe(4)

    designSessionFixture.file = {
      ...currentDesign.value!,
      name: 'replacement',
    }
    expect(history.canUndo.value).toBe(false)
    expect(history.canRedo.value).toBe(false)
  })
})
