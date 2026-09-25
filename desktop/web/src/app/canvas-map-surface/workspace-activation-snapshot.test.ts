import { batch, effect } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import { layerOpacity, layerVisibility } from '../canvas-settings/signals'
import { basemapStyle } from '../settings/state'
import { normalizeBasemapStyle } from '../../maplibre/config'
import { DEFAULT_NEW_DESIGN_VIEW } from '../../canvas/session-plane'
import { readWorkspaceActivationSnapshot, readWorkspaceBasemapPresentation } from './workspace-activation-snapshot'

const identity = {}

function store(hasDesign = true) {
  return {
    hasCurrentDesign: () => hasDesign,
    sessionIdentity: { peek: () => identity },
  } as never
}

describe('readWorkspaceActivationSnapshot', () => {
  it('returns null without a current Design', () => {
    expect(readWorkspaceActivationSnapshot({ store: store(false) })).toBeNull()
  })

  it('copies the initial map centre and normalized basemap presentation', () => {
    const presentation = {
      layerVisibility: { base: true },
      layerOpacity: { base: Number.NaN },
    }
    const snapshot = readWorkspaceActivationSnapshot({
      store: store(),
      readInitialCenter: () => ({ lat: 48.86, lon: 2.35 }),
      readBasemapStyle: () => 'street',
      readMapLayerPresentation: () => presentation,
    })
    expect(snapshot).toEqual(expect.objectContaining({
      sessionIdentity: identity,
      maximumWorldExtentMeters: undefined,
      map: expect.objectContaining({
        initialCenter: { lat: 48.86, lon: 2.35 }, basemapOpacity: 0,
      }),
    }))
    expect(snapshot?.map).not.toHaveProperty('anchor')
    expect(snapshot?.map).not.toHaveProperty('northBearingDeg')
    expect(snapshot?.map).not.toHaveProperty('placementStatus')
    presentation.layerVisibility.base = false
    expect(snapshot?.map.basemapVisible).toBe(true)
    expect(Object.isFrozen(snapshot?.map.initialCenter)).toBe(true)
  })

  it('centres a Design without a session plane origin on the new-Design default view', () => {
    const snapshot = readWorkspaceActivationSnapshot({
      store: store(),
      readBasemapStyle: () => 'street',
      readMapLayerPresentation: () => ({ layerVisibility: {}, layerOpacity: {} }),
    })
    expect(snapshot?.map.initialCenter).toEqual({
      lat: DEFAULT_NEW_DESIGN_VIEW.lat,
      lon: DEFAULT_NEW_DESIGN_VIEW.lon,
    })
    expect(snapshot?.map.basemapVisible).toBe(true)
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
