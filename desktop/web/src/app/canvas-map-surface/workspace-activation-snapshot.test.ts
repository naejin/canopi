import { batch, effect } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import { layerOpacity, layerVisibility } from '../canvas-settings/signals'
import { basemapStyle } from '../settings/state'
import { normalizeBasemapStyle } from '../../maplibre/config'
import { readWorkspaceActivationSnapshot, readWorkspaceBasemapPresentation } from './workspace-activation-snapshot'

const identity = {}
const frame = {
  anchor_latitude_deg: 48.86,
  anchor_longitude_deg: 2.35,
  north_bearing_deg: 12,
  placement_status: 'confirmed' as const,
  location_metadata: { altitude_m: null },
}

function store(hasDesign = true, spatialFrame: typeof frame | null = frame) {
  return {
    hasCurrentDesign: () => hasDesign,
    readMetadata: () => ({ spatialFrame }),
    sessionIdentity: { peek: () => identity },
  } as never
}

describe('readWorkspaceActivationSnapshot', () => {
  it('returns null without a current Design', () => {
    expect(readWorkspaceActivationSnapshot({ store: store(false) })).toBeNull()
  })

  it('copies only session spatial facts and normalized basemap presentation', () => {
    const presentation = {
      layerVisibility: { base: true },
      layerOpacity: { base: Number.NaN },
    }
    const snapshot = readWorkspaceActivationSnapshot({
      store: store(),
      readBasemapStyle: () => 'street',
      readMapLayerPresentation: () => presentation,
    })
    expect(snapshot).toEqual(expect.objectContaining({
      sessionIdentity: identity,
      maximumWorldExtentMeters: undefined,
      map: expect.objectContaining({
        anchor: { lat: 48.86, lon: 2.35 }, northBearingDeg: 12, basemapOpacity: 0,
      }),
    }))
    presentation.layerVisibility.base = false
    expect(snapshot?.map.basemapVisible).toBe(true)
    expect(Object.isFrozen(snapshot?.map.anchor)).toBe(true)
  })

  it('rejects a missing spatial frame for a current Design', () => {
    expect(() => readWorkspaceActivationSnapshot({ store: store(true, null) }))
      .toThrow('missing its required spatial frame')
  })

  it('shares normalized presentation with the live settings reader', () => {
    expect(readWorkspaceBasemapPresentation({
      readBasemapStyle: () => 'street',
      readMapLayerPresentation: () => ({
        layerVisibility: { base: false }, layerOpacity: { base: 2 },
      }),
    })).toEqual({ basemapStyle: 'street', basemapVisible: false, basemapOpacity: 1 })
  })

  it('tracks style, visibility, and opacity through the default settings projection', () => {
    const previousStyle = basemapStyle.peek()
    const previousVisibility = layerVisibility.peek()
    const previousOpacity = layerOpacity.peek()
    const seen: ReturnType<typeof readWorkspaceBasemapPresentation>[] = []
    const dispose = effect(() => {
      seen.push(readWorkspaceBasemapPresentation())
    })

    try {
      const nextStyle = previousStyle === 'street' ? 'satellite' : 'street'
      basemapStyle.value = nextStyle
      expect(seen).toHaveLength(2)
      expect(seen.at(-1)?.basemapStyle).toBe(normalizeBasemapStyle(nextStyle))

      batch(() => {
        layerVisibility.value = { ...previousVisibility, base: !(previousVisibility.base ?? true) }
        layerOpacity.value = { ...previousOpacity, base: 0.37 }
      })

      expect(seen.at(-1)).toEqual({
        basemapStyle: normalizeBasemapStyle(nextStyle),
        basemapVisible: !(previousVisibility.base ?? true),
        basemapOpacity: 0.37,
      })
    } finally {
      dispose()
      batch(() => {
        basemapStyle.value = previousStyle
        layerVisibility.value = previousVisibility
        layerOpacity.value = previousOpacity
      })
    }
  })
})
