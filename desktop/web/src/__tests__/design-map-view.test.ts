// U28: a Design keeps the view it was saved with (`map_view`, GeoLibre's mapView). Saving writes the live view; panning
// alone neither edits the Design nor makes a replacement guard stale. Driven through the real runtime and the real
// persistence and replacement paths.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppCanvasRuntimeAppAdapter } from '../app/canvas-runtime/app-adapter'
import { createDesignSessionPersistence } from '../app/document-session/persistence'
import { createDesignSessionReplacement } from '../app/document-session/replacement'
import { createMemoryDesignSessionStore } from '../app/document-session/store'
import {
  prepareDesignWriteDestination,
  prepareSynchronousDesignWriteDestination,
} from '../app/document-session/write-admission'
import { savedViewCameraOf } from '../canvas/saved-view-framing'
import { geographicViewOfCamera } from '../canvas/session-plane'
import { CURRENT_CANOPI_FILE_VERSION } from '../generated/canopi-design-format'
import type { CanopiFile } from '../types/design'
import { createLiveTestCanvasRuntimeHost, type CanvasRuntimeHost } from './support/live-canvas-runtime'

const SITE = { lon: -1.5536, lat: 47.2184 }
const PATH = '/designs/orchard.canopi'

function orchard(): CanopiFile {
  const plant = (id: string, lonOffset: number): CanopiFile['plants'][number] => ({
    id, locked: false, canonical_name: 'Malus domestica', common_name: null, color: null,
    pinned_name: false, position: { lon: SITE.lon + lonOffset, lat: SITE.lat }, rotation: null, scale: null, notes: null,
    planted_date: null, quantity: null,
  })
  return {
    version: CURRENT_CANOPI_FILE_VERSION,
    name: 'Orchard',
    description: null,
    plant_species_colors: {},
    layers: [],
    plants: [plant('a', 0), plant('b', 0.0004)],
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

const hosts: CanvasRuntimeHost[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.destroy()
})

/** The orchard opened from its file through the replacement path, on a 1200 x 800 map whose clean state reaches `store`. */
function openOrchard(): { host: CanvasRuntimeHost; store: ReturnType<typeof createMemoryDesignSessionStore> } {
  const store = createMemoryDesignSessionStore({ file: null })
  const host = createLiveTestCanvasRuntimeHost({
    screen: { width: 1200, height: 800 },
    appAdapter: {
      ...createAppCanvasRuntimeAppAdapter({ presentationData: {} }),
      cleanState: { setCanvasClean: (clean) => store.setCanvasClean(clean) },
    },
  })
  hosts.push(host)
  const replacement = createDesignSessionReplacement({ store, workflowRunner: { install: vi.fn(), dispose: vi.fn() } })
  replacement.replace({ file: orchard(), kind: 'loaded', path: PATH, name: 'Orchard' }, host.surfaces.documents, () => true)
  return { host, store }
}

/** Pans, zooms and turns the live view, as the map's gestures move it. */
function moveTheView(host: CanvasRuntimeHost): void {
  const camera = host.cameraHost.current()
  camera.apply({ kind: 'pan-by', deltaPx: { x: 140, y: -60 } })
  camera.apply({ kind: 'zoom-around', anchorPx: { x: 300, y: 200 }, factor: 1.6 })
  camera.apply({ kind: 'rotate-around', anchorPx: 'centre', bearingDeg: 35, animation: 'none' })
}

/** What saving now should write: the live view as stored, with the ground the whole map shows. */
function liveMapView(host: CanvasRuntimeHost) {
  const { camera, screen } = host.surfaces.queries.view.captureView()
  return savedViewCameraOf(geographicViewOfCamera(camera), screen)
}

describe('the view a Design is saved with', () => {
  it('Save and the Web draft write the live view after a pan, zoom and turn', async () => {
    const { host, store } = openOrchard()
    const persistence = createDesignSessionPersistence({ store })
    persistence.attachCanvas(host.surfaces.documents)
    moveTheView(host)
    const expected = liveMapView(host)
    expect(expected.bearing).toBeCloseTo(35, 6)
    expect(expected.ground_size_m).toBeDefined()

    const saved: CanopiFile[] = []
    await persistence.beginSave().execute(prepareDesignWriteDestination({
      resource: `native-design:${PATH}`,
      destinationPath: PATH,
      write: (content) => { saved.push(content) },
    }))
    const drafted: CanopiFile[] = []
    persistence.beginBrowserDraft().executeImmediately(prepareSynchronousDesignWriteDestination({
      resource: 'browser-app-data:drafts',
      write: (content) => { drafted.push(content) },
    }))

    expect(saved.map((file) => file.map_view)).toEqual([expected])
    expect(drafted.map((file) => file.map_view)).toEqual([expected])
  })

  it('panning alone leaves the Design clean, adds no undo step, starts no write and keeps a replacement guard current', () => {
    const { host, store } = openOrchard()
    const persistence = createDesignSessionPersistence({ store })
    persistence.attachCanvas(host.surfaces.documents)
    const guard = persistence.beginReplacementGuard().guard
    const canvasRevision = store.canvasChangeRevision.value
    const designRevision = store.committedDesignRevision.value

    moveTheView(host)

    expect(store.isDesignDirty()).toBe(false)
    expect(host.surfaces.commands.history.canUndo.value).toBe(false)
    expect(store.canvasChangeRevision.value, 'continuous save writes on a canvas change').toBe(canvasRevision)
    expect(store.committedDesignRevision.value, 'or on a Design change').toBe(designRevision)
    expect(guard?.isCurrent(), 'a pan is not a change a replacement must guard').toBe(true)
  })
})
