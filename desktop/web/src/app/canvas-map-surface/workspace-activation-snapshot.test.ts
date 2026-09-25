import { effect } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import { createDefaultMapLayers, mapLayers, type MapLayersState } from '../map-layers/state'
import { locale } from '../settings/state'
import { DEFAULT_NEW_DESIGN_VIEW } from '../../canvas/session-plane'
import { readWorkspaceActivationSnapshot, readWorkspaceBackgroundPresentation } from './workspace-activation-snapshot'

const identity = {}

function store(hasDesign = true) {
  return {
    hasCurrentDesign: () => hasDesign,
    sessionIdentity: { peek: () => identity },
  } as never
}

function layers(overrides: {
  basemap?: Partial<MapLayersState['basemap']>
  satellite?: Partial<MapLayersState['satellite']>
} = {}): MapLayersState {
  const defaults = createDefaultMapLayers()
  return {
    ...defaults,
    basemap: { ...defaults.basemap, ...overrides.basemap },
    satellite: { ...defaults.satellite, ...overrides.satellite },
  }
}

describe('readWorkspaceActivationSnapshot', () => {
  it('returns null without a current Design', () => {
    expect(readWorkspaceActivationSnapshot({ store: store(false) })).toBeNull()
  })

  it('copies the initial map centre and normalized background presentation', () => {
    const basemap = { style: 'positron' as const, visible: true, opacity: Number.NaN }
    const snapshot = readWorkspaceActivationSnapshot({
      store: store(),
      readInitialCenter: () => ({ lat: 48.86, lon: 2.35 }),
      readMapLayers: () => ({ ...layers(), basemap }),
      readLocale: () => 'fr',
    })
    expect(snapshot).toEqual(expect.objectContaining({
      sessionIdentity: identity,
      maximumWorldExtentMeters: undefined,
      map: expect.objectContaining({
        initialCenter: { lat: 48.86, lon: 2.35 },
        background: {
          basemap: { style: 'positron', visible: true, opacity: 0 },
          satellite: { visible: false, opacity: 1 },
          locale: 'fr',
        },
      }),
    }))
    expect(snapshot?.map).not.toHaveProperty('anchor')
    expect(snapshot?.map).not.toHaveProperty('northBearingDeg')
    expect(snapshot?.map).not.toHaveProperty('placementStatus')
    basemap.visible = false
    expect(snapshot?.map.background.basemap.visible).toBe(true)
    expect(Object.isFrozen(snapshot?.map.initialCenter)).toBe(true)
    expect(Object.isFrozen(snapshot?.map.background)).toBe(true)
    expect(Object.isFrozen(snapshot?.map.background.basemap)).toBe(true)
  })

  it('centres a Design without a session plane origin on the new-Design default view', () => {
    const snapshot = readWorkspaceActivationSnapshot({
      store: store(),
      readMapLayers: () => layers(),
      readLocale: () => 'en',
    })
    expect(snapshot?.map.initialCenter).toEqual({
      lat: DEFAULT_NEW_DESIGN_VIEW.lat,
      lon: DEFAULT_NEW_DESIGN_VIEW.lon,
    })
    expect(snapshot?.map.background.basemap.visible).toBe(true)
  })

  it('shares normalized presentation with the live settings reader', () => {
    expect(readWorkspaceBackgroundPresentation({
      readMapLayers: () => layers({
        basemap: { style: 'dark', visible: false, opacity: 2 },
        satellite: { visible: true, opacity: -1 },
      }),
      readLocale: () => 'de',
    })).toEqual({
      basemap: { style: 'dark', visible: false, opacity: 1 },
      satellite: { visible: true, opacity: 0 },
      locale: 'de',
    })
  })

  it('never carries the Google key into the background presentation', () => {
    const presentation = readWorkspaceBackgroundPresentation({
      readMapLayers: () => layers({ satellite: { visible: true } }),
      readLocale: () => 'en',
    })
    expect(Object.keys(presentation.satellite).sort()).toEqual(['opacity', 'visible'])
  })

  it('tracks the map layer store and locale through the default readers', () => {
    const previousLayers = mapLayers.peek()
    const previousLocale = locale.peek()
    const seen: ReturnType<typeof readWorkspaceBackgroundPresentation>[] = []
    const dispose = effect(() => {
      seen.push(readWorkspaceBackgroundPresentation())
    })

    try {
      mapLayers.value = layers({ basemap: { style: 'bright', visible: false, opacity: 0.37 } })
      expect(seen).toHaveLength(2)
      expect(seen.at(-1)?.basemap).toEqual({ style: 'bright', visible: false, opacity: 0.37 })

      mapLayers.value = layers({ satellite: { visible: true, opacity: 0.5 } })
      expect(seen.at(-1)?.satellite).toEqual({ visible: true, opacity: 0.5 })

      locale.value = previousLocale === 'fr' ? 'de' : 'fr'
      expect(seen).toHaveLength(4)
      expect(seen.at(-1)?.locale).toBe(locale.peek())
    } finally {
      dispose()
      mapLayers.value = previousLayers
      locale.value = previousLocale
    }
  })
})
