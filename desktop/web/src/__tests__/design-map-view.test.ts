// U28: a Design keeps the view it was saved with (`map_view`, GeoLibre's mapView). Saving writes the live view; panning
// alone neither edits the Design nor makes a replacement guard stale, but every flush (Save, close, switching Designs, page
// hide) writes a view that moved. Driven through the real runtime and the real persistence, continuous-save and replacement paths.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppCanvasRuntimeAppAdapter } from '../app/canvas-runtime/app-adapter'
import { createContinuousSave } from '../app/document-session/continuous-save'
import { createDesignSessionPersistence } from '../app/document-session/persistence'
import { createDesignSessionReplacement } from '../app/document-session/replacement'
import { createDesignSessionStateMachine } from '../app/document-session/state-machine'
import { createMemoryDesignSessionStore } from '../app/document-session/store'
import {
  prepareDesignWriteDestination,
  prepareSynchronousDesignWriteDestination,
} from '../app/document-session/write-admission'
import { persistLastView } from '../app/canvas-map-surface/last-view'
import { resetSettingsProjectionForTests } from '../app/settings/projection'
import { lastView } from '../app/settings/state'
import { savedViewCameraOf, savedViewZoom } from '../canvas/saved-view-framing'
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
  resetSettingsProjectionForTests()
  lastView.value = null
})

/** A live runtime on a map of `screen` whose clean state reaches `store`. */
function liveHost(
  store: ReturnType<typeof createMemoryDesignSessionStore>,
  screen = { width: 1200, height: 800 },
): CanvasRuntimeHost {
  const host = createLiveTestCanvasRuntimeHost({
    screen,
    appAdapter: {
      ...createAppCanvasRuntimeAppAdapter({ presentationData: {} }),
      cleanState: { setCanvasClean: (clean) => store.setCanvasClean(clean) },
    },
  })
  hosts.push(host)
  return host
}

/** A file opened through the replacement path, on a map of `screen` (1200 x 800) whose clean state reaches `store`. */
function openOrchard(
  file: CanopiFile = orchard(),
  screen = { width: 1200, height: 800 },
): { host: CanvasRuntimeHost; store: ReturnType<typeof createMemoryDesignSessionStore> } {
  const store = createMemoryDesignSessionStore({ file: null })
  const host = liveHost(store, screen)
  const replacement = createDesignSessionReplacement({ store, workflowRunner: { install: vi.fn(), dispose: vi.fn() } })
  replacement.replace({ file, kind: 'loaded', path: PATH, name: file.name }, host.surfaces.documents, () => true)
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

/** Continuous save of the open orchard, wired as both editions wire it; `drafts` collects each write. */
function draftContinuousSave(host: CanvasRuntimeHost, store: ReturnType<typeof createMemoryDesignSessionStore>) {
  const persistence = createDesignSessionPersistence({ store })
  persistence.attachCanvas(host.surfaces.documents)
  const drafts: CanopiFile[] = []
  const continuousSave = createContinuousSave({
    store,
    viewMoved: () => persistence.viewMovedSinceSave(),
    writeHome: () => {
      persistence.beginBrowserDraft().executeImmediately(prepareSynchronousDesignWriteDestination({
        resource: 'browser-app-data:drafts',
        write: (content) => { drafts.push(content) },
      }))
      return { kind: 'written' }
    },
  })
  continuousSave.beginSession({ draftId: 'draft-1', fingerprint: null, writePending: false })
  return { continuousSave, drafts }
}

describe('a view that moved since the last save', () => {
  it('reaches the home with the next flush, though nothing reads as unsaved and no timer writes it', async () => {
    vi.useFakeTimers()
    try {
      const { host, store } = openOrchard()
      const { continuousSave, drafts } = draftContinuousSave(host, store)
      const uninstall = continuousSave.install()
      moveTheView(host)
      const moved = liveMapView(host)

      await vi.advanceTimersByTimeAsync(10_000)
      expect(drafts, 'a camera move schedules no write').toEqual([])
      expect(continuousSave.hasPendingChanges()).toBe(false)
      expect(continuousSave.status.value, 'the file reads as saved').toBe('saved')

      expect(await continuousSave.flush()).toBe(true)
      expect(drafts.map((file) => file.map_view)).toEqual([moved])

      expect(await continuousSave.flush()).toBe(true)
      expect(drafts, 'the home holds that view now').toHaveLength(1)
      uninstall()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a reopened Design writes nothing until its view moves, even in a window of another size', async () => {
    const file = savedOrchard()
    const { host, store } = openOrchard(file, { width: 800, height: 600 })
    const { continuousSave, drafts } = draftContinuousSave(host, store)

    expect(await continuousSave.flush()).toBe(true)
    expect(drafts).toEqual([])

    host.cameraHost.current().apply({ kind: 'pan-by', deltaPx: { x: 30, y: 0 } })
    expect(await continuousSave.flush()).toBe(true)
    expect(drafts.map((saved) => saved.map_view)).toEqual([liveMapView(host)])
  })
})

/** The orchard as saved after a pan, zoom and turn on a 1200 x 800 map. */
function savedOrchard(): CanopiFile {
  const { host } = openOrchard()
  moveTheView(host)
  return { ...orchard(), map_view: liveMapView(host) }
}

function cameraOf(host: CanvasRuntimeHost) {
  return host.surfaces.queries.view.captureView().camera
}

function expectCameraAt(host: CanvasRuntimeHost, at: { lon: number; lat: number; zoom: number; bearing: number }): void {
  const camera = cameraOf(host)
  expect(camera.center.lon).toBeCloseTo(at.lon, 9)
  expect(camera.center.lat).toBeCloseTo(at.lat, 9)
  expect(camera.zoom).toBeCloseTo(at.zoom, 9)
  expect(camera.bearingDeg).toBeCloseTo(at.bearing, 9)
}

describe('opening a Design at the view it was saved with', () => {
  it('the window it was saved in restores the exact camera', () => {
    const file = savedOrchard()
    const { host } = openOrchard(file)

    expectCameraAt(host, file.map_view!)
  })

  it('a smaller window zooms out just enough to show the framed ground, at the same centre and bearing', () => {
    const file = savedOrchard()
    const smaller = { width: 800, height: 600 }
    const { host } = openOrchard(file, smaller)

    const zoom = savedViewZoom(file.map_view!, smaller)
    expect(zoom).toBeLessThan(file.map_view!.zoom - 0.1)
    expectCameraAt(host, { ...file.map_view!, zoom })
  })

  it('an empty Design with a saved view opens north up on the new-Design overview', () => {
    const file = { ...orchard(), plants: [], map_view: savedOrchard().map_view }
    const { host } = openOrchard(file)

    expect(cameraOf(host).bearingDeg).toBe(0)
    expect(host.surfaces.queries.view.mode.value).toBe('overview')
  })

  it('a file without one opens with the fit at the last view\'s bearing', () => {
    persistLastView({ ...SITE, zoom: 18, bearing: 30 })
    const saved = savedOrchard()
    const { host } = openOrchard()

    expect(cameraOf(host).bearingDeg).toBeCloseTo(30, 6)
    expect(cameraOf(host).zoom).not.toBeCloseTo(saved.map_view!.zoom, 3)
  })

  it('a cold open restores it, and the renderer mount does not fit over it', async () => {
    const file = savedOrchard()
    const host = createLiveTestCanvasRuntimeHost({
      screen: { width: 1200, height: 800 },
      renderer: { id: 'test', initialize: () => ({ id: 'maplibre-pixi', syncScene: () => {}, setView: () => {}, setDraft: () => {}, dispose: () => {} }) },
    })
    hosts.push(host)
    host.surfaces.documents.loadDocument(file)
    host.surfaces.documents.zoomToFit()
    expectCameraAt(host, file.map_view!)

    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 1200 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 800 })
    await host.init(container)

    expectCameraAt(host, file.map_view!)
  })
})

/** One undoable Scene edit: every plant is locked. */
function editTheDesign(host: CanvasRuntimeHost): void {
  host.surfaces.commands.sceneEdits.selectAll()
  host.surfaces.commands.sceneEdits.lockSelected()
}

const SAVE_AS_PATH = '/designs/orchard-copy.canopi'

/** The orchard opened from its file on Desktop through the real session state machine; `writes` collects each file write. */
async function openOnDesktop(file: CanopiFile = orchard()) {
  const store = createMemoryDesignSessionStore({ file: null })
  const host = liveHost(store)
  const writes: { path: string; content: CanopiFile }[] = []
  const requestSaveDecision = vi.fn(async () => 'cancel')
  const machine = createDesignSessionStateMachine({
    store,
    getCurrentSession: () => host.surfaces.documents,
    selectDesignSavePath: async () => SAVE_AS_PATH,
    prepareDesignWrite: (path, _expectedFingerprint, onWritten) => prepareDesignWriteDestination({
      resource: `native-design:${path}`,
      destinationPath: path,
      write: async (content) => {
        writes.push({ path, content })
        onWritten(`fp-${writes.length}`)
      },
    }),
    prepareDraftWrite: (id) => prepareDesignWriteDestination({
      resource: `native-draft:${id}`,
      write: () => { throw new Error('the orchard has a file home') },
    }),
    deleteDesignDraft: async () => undefined,
    requestSaveDecision: requestSaveDecision as never,
    workflowRunner: { install: vi.fn(), dispose: vi.fn() },
  })
  machine.beginEmptyDocumentSession(host.surfaces.documents)
  await expect(machine.transitionDocument({
    source: 'open-path',
    dirtyGuard: 'flush',
    session: host.surfaces.documents,
    load: async () => ({ file, path: PATH, name: file.name, fingerprint: 'fp-0' }),
  })).resolves.toMatchObject({ status: 'applied' })
  return { host, store, machine, writes, requestSaveDecision }
}

describe('the view reaches the home only with a write that already happens (U30)', () => {
  it('an edit, then a pan: the next continuous save writes the panned view, and reopening restores it', async () => {
    vi.useFakeTimers()
    try {
      const { host, machine, writes } = await openOnDesktop()
      const uninstall = machine.continuousSave.install()
      editTheDesign(host)
      moveTheView(host)
      const panned = liveMapView(host)

      await vi.advanceTimersByTimeAsync(10_000)
      uninstall()

      expect(writes.map((write) => write.content.map_view)).toEqual([panned])
      const { host: reopened } = openOrchard(writes[0]!.content)
      expectCameraAt(reopened, panned)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a manual Save writes the live view with the edits, and Save As writes it with no edit', async () => {
    const { host, machine, writes } = await openOnDesktop()
    editTheDesign(host)
    moveTheView(host)

    await expect(machine.saveCurrentDesign()).resolves.toBe(true)
    expect(writes.map((write) => [write.path, write.content.map_view])).toEqual([[PATH, liveMapView(host)]])

    host.cameraHost.current().apply({ kind: 'pan-by', deltaPx: { x: 30, y: 0 } })
    await expect(machine.saveAsCurrentDesign()).resolves.toMatchObject({ status: 'applied' })
    expect(writes.map((write) => write.path)).toEqual([PATH, SAVE_AS_PATH])
    expect(writes[1]?.content.map_view).toEqual(liveMapView(host))
  })
})
