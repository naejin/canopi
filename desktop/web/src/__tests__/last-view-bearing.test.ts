// The last view's bearing (spec §4.15): the first Design opened with content turns to the stored bearing, a new or empty
// Design opens north up, and settings written before the bearing existed read as north up.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { persistLastView } from '../app/canvas-map-surface/last-view'
import { createAppCanvasRuntimeAppAdapter } from '../app/canvas-runtime/app-adapter'
import { createDesignSessionReplacement } from '../app/document-session/replacement'
import { createMemoryDesignSessionStore } from '../app/document-session/store'
import { hydrateSettingsProjectionForTests, resetSettingsProjectionForTests } from '../app/settings/projection'
import { lastView } from '../app/settings/state'
import { CURRENT_CANOPI_FILE_VERSION } from '../generated/canopi-design-format'
import { DEFAULT_SETTINGS } from '../generated/settings'
import { createBrowserSettingsPlatformAdapter } from '../platform/settings.browser'
import type { CanopiFile } from '../types/design'
import { createLiveTestCanvasRuntimeHost, type CanvasRuntimeHost } from './support/live-canvas-runtime'

const SITE = { lon: -1.5536, lat: 47.2184 }

function design(name: string, plants: CanopiFile['plants'] = []): CanopiFile {
  return {
    version: CURRENT_CANOPI_FILE_VERSION,
    name,
    description: null,
    plant_species_colors: {},
    layers: [],
    plants,
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-09-25T00:00:00.000Z',
    updated_at: '2026-09-25T00:00:00.000Z',
  }
}

function orchard(): CanopiFile {
  const plant = (id: string, lonOffset: number): CanopiFile['plants'][number] => ({
    id, locked: false, canonical_name: 'Malus domestica', common_name: null, color: null,
    pinned_name: false, position: { lon: SITE.lon + lonOffset, lat: SITE.lat }, rotation: null, scale: null, notes: null,
    planted_date: null, quantity: null,
  })
  return design('Orchard', [plant('a', 0), plant('b', 0.0004)])
}

const hosts: CanvasRuntimeHost[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.destroy()
  resetSettingsProjectionForTests()
  lastView.value = null
})

function openRuntime(): CanvasRuntimeHost {
  const host = createLiveTestCanvasRuntimeHost({
    screen: { width: 1200, height: 800 },
    appAdapter: createAppCanvasRuntimeAppAdapter({ presentationData: {} }),
  })
  hosts.push(host)
  return host
}

function bearingOf(host: CanvasRuntimeHost): number {
  return host.surfaces.queries.view.captureView().camera.bearingDeg
}

function replaceWith(host: CanvasRuntimeHost, file: CanopiFile, kind: 'new' | 'loaded'): void {
  const store = createMemoryDesignSessionStore({ file: orchard(), path: '/designs/orchard.canopi', name: 'Orchard' })
  const replacement = createDesignSessionReplacement({ store, workflowRunner: { install: vi.fn(), dispose: vi.fn() } })
  replacement.replace({ file, kind, path: kind === 'new' ? null : '/designs/other.canopi', name: file.name }, host.surfaces.documents, () => true)
}

describe('the last view bearing', () => {
  it('reopening a Design with content restores 30', () => {
    persistLastView({ ...SITE, zoom: 18, bearing: 30 })
    const host = openRuntime()

    host.surfaces.documents.loadDocument(orchard())
    host.surfaces.documents.zoomToFit()

    expect(bearingOf(host)).toBeCloseTo(30, 6)
  })

  it('a new Design opens north-up mid-session at 30', () => {
    persistLastView({ ...SITE, zoom: 18, bearing: 30 })
    const host = openRuntime()
    host.surfaces.documents.loadDocument(orchard())
    host.surfaces.documents.zoomToFit()
    expect(bearingOf(host)).toBeCloseTo(30, 6)

    replaceWith(host, design('Untitled'), 'new')

    expect(bearingOf(host)).toBe(0)
  })

  it('a Design opened later in the session keeps the live bearing, not the stored one', () => {
    persistLastView({ ...SITE, zoom: 18, bearing: 30 })
    const host = openRuntime()
    host.surfaces.documents.loadDocument(orchard())
    host.surfaces.documents.zoomToFit()
    const camera = host.surfaces.queries.view.captureView().camera
    host.surfaces.commands.viewport.showCamera({ ...camera, bearingDeg: 60 }, { motion: 'jump' })

    replaceWith(host, orchard(), 'loaded')

    expect(bearingOf(host)).toBeCloseTo(60, 6)
  })

  it('settings without bearing read as 0', async () => {
    // The Web edition's reader (the desktop reads through serde's default, common-types settings.rs).
    const adapter = createBrowserSettingsPlatformAdapter({
      loadSettings: () => ({ last_view: { lon: SITE.lon, lat: SITE.lat, zoom: 18 } }),
      saveSettings: (settings) => ({ ok: true, value: settings }),
    })
    const loaded = await adapter.load()
    expect(loaded).toMatchObject({ last_view: { lon: SITE.lon, lat: SITE.lat, zoom: 18, bearing: 0 } })

    // The settings projection, given a record from an earlier build.
    hydrateSettingsProjectionForTests({ ...DEFAULT_SETTINGS, last_view: { lon: SITE.lon, lat: SITE.lat, zoom: 18 } })
    expect(lastView.value).toEqual({ lon: SITE.lon, lat: SITE.lat, zoom: 18, bearing: 0 })

    // A Design with content opened from it is north up.
    const host = openRuntime()
    host.surfaces.documents.loadDocument(orchard())
    host.surfaces.documents.zoomToFit()
    expect(bearingOf(host)).toBe(0)
  })
})
