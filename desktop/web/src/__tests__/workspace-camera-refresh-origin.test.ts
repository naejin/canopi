import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { createDetachedCanvasRuntimeAppAdapter } from '../canvas/runtime/app-adapter'
import { MAPLIBRE_SCENE_RENDERER_ID } from '../canvas/runtime/renderers/maplibre-scene'
import { createDetachedSceneRuntimePanelTargetAdapter } from '../canvas/runtime/scene-runtime/panel-target-adapter'
import {
  geoToMercator,
  mercatorUnitsPerMeterAtLat,
  viewportCenterWorld,
} from '../canvas/projection'
import {
  createSessionPlane,
  DEFAULT_NEW_DESIGN_VIEW,
  type SessionPlane,
} from '../canvas/session-plane'
import {
  MapLibreWorkspaceCameraOwner,
  type MapLibreWorkspaceCameraMap,
} from '../maplibre/workspace-camera'
import type { SharedMapSceneRendererComposition } from '../maplibre/shared-scene-renderer'
import type { WorkspaceActivationOptions } from '../app/canvas-map-surface/workspace-activation'
import type { WorkspaceGenerationLifecycle } from '../app/canvas-map-surface/workspace-generation-reconciler'
import { createWorkspaceRuntimeComposition } from '../app/canvas-map-surface/workspace-runtime-composition'
import { createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'

const MAPLIBRE_WORLD_TILE_SIZE = 512

/** A north-up, unpitched Web Mercator map whose projection follows its camera. */
class MercatorMap {
  readonly canvas = document.createElement('canvas')
  center: { lng: number; lat: number }
  zoom: number
  readonly jumpTo = vi.fn((options: { center: [number, number]; zoom: number }) => {
    this.center = { lng: options.center[0], lat: options.center[1] }
    this.zoom = options.zoom
  })
  readonly resize = vi.fn()
  readonly on = vi.fn()
  readonly off = vi.fn()
  readonly getPitch = () => 0
  readonly getZoom = () => this.zoom
  readonly getMinZoom = () => 0
  readonly getMaxZoom = () => 27
  readonly getCenter = () => this.center
  readonly getCanvas = () => this.canvas

  constructor(center: { lng: number; lat: number }, zoom: number) {
    this.center = center
    this.zoom = zoom
    Object.defineProperties(this.canvas, {
      clientWidth: { value: 400, configurable: true },
      clientHeight: { value: 300, configurable: true },
      width: { value: 400, configurable: true, writable: true },
      height: { value: 300, configurable: true, writable: true },
    })
  }

  readonly project = ([lng, lat]: [number, number]) => {
    const point = geoToMercator(lng, lat)
    const centre = geoToMercator(this.center.lng, this.center.lat)
    const worldSize = MAPLIBRE_WORLD_TILE_SIZE * 2 ** this.zoom
    return {
      x: 200 + (point.x - centre.x) * worldSize,
      y: 150 + (point.y - centre.y) * worldSize,
    }
  }
}

function centreGeo(owner: MapLibreWorkspaceCameraOwner, plane: SessionPlane) {
  const frame = owner.snapshot.value
  return plane.toGeo(viewportCenterWorld(frame.viewport, frame.screenSize))
}

describe('MapLibreWorkspaceCameraOwner.attachment.refreshOrigin', () => {
  it('republishes the plane viewport for a new origin while the map stays put', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 300 })
    const firstPlane = createSessionPlane({ lon: 2.3522, lat: 48.8566 })
    let plane = firstPlane
    const map = new MercatorMap({ lng: 2.3522, lat: 48.8566 }, 18)
    expect(owner.attachment.attach({
      map: map as unknown as MapLibreWorkspaceCameraMap,
      readOrigin: () => plane.origin,
      maximumWorldExtentMeters: 50_000,
    })).toBe(true)
    const jumps = map.jumpTo.mock.calls.length
    const mapCenter = { ...map.center }
    const mapZoom = map.zoom
    const before = owner.snapshot.value
    const geoBefore = centreGeo(owner, firstPlane)

    // A re-origin about 20 km east, as the runtime publishes after panning away.
    const nextPlane = createSessionPlane(firstPlane.toGeo({ x: 20_000, y: -5_000 }))
    plane = nextPlane
    owner.attachment.refreshOrigin()

    const after = owner.snapshot.value
    expect(map.jumpTo).toHaveBeenCalledTimes(jumps)
    expect(map.center).toEqual(mapCenter)
    expect(map.zoom).toBe(mapZoom)
    expect(after.revision).toBeGreaterThan(before.revision)
    const expectedOrigin = map.project([nextPlane.origin.lon, nextPlane.origin.lat])
    expect(after.viewport.x).toBeCloseTo(expectedOrigin.x, 6)
    expect(after.viewport.y).toBeCloseTo(expectedOrigin.y, 6)
    expect(after.viewport.scale).toBeCloseTo(
      MAPLIBRE_WORLD_TILE_SIZE * 2 ** mapZoom * mercatorUnitsPerMeterAtLat(nextPlane.origin.lat),
      6,
    )
    // The same geography stays under the screen centre in the new plane.
    const geoAfter = centreGeo(owner, nextPlane)
    expect(geoAfter.lon).toBeCloseTo(geoBefore.lon, 9)
    expect(geoAfter.lat).toBeCloseTo(geoBefore.lat, 9)
    expect(owner.policy.referenceLatitudeDeg).toBe(nextPlane.origin.lat)
    expect(after.groundMetersPerCssPixel).not.toBeNull()
  })

  it('is inert without an attached map', () => {
    const owner = new MapLibreWorkspaceCameraOwner()
    owner.initialize({ width: 400, height: 300 })
    const before = owner.snapshot.value

    expect(() => owner.attachment.refreshOrigin()).not.toThrow()
    expect(owner.snapshot.value).toBe(before)
  })
})

describe('workspace runtime composition origin effect', () => {
  function compositionFixture() {
    const sessionPlane = signal<SessionPlane | null>(null)
    const surfaces = createTestCanvasRuntimeSurfaces({
      queries: { ...createTestCanvasQuerySurface(), sessionPlane },
    })
    const runtime = {
      commandSurface: surfaces.commands,
      querySurface: surfaces.queries,
      documentSurface: surfaces.documents,
      init: vi.fn(async () => {}),
      reportRendererFailure: vi.fn(async () => {}),
      destroy: vi.fn(),
    }
    const camera = new MapLibreWorkspaceCameraOwner()
    const refreshOrigin = vi.spyOn(camera.attachment, 'refreshOrigin')
    const workspace = {
      requestGenerationDisconnect: vi.fn(async () => {}),
      activate: vi.fn(async () => 'shared-ready' as const),
      teardown: vi.fn(async () => {}),
      updateMapContributions: vi.fn(),
      updateBasemapPresentation: vi.fn(),
    } satisfies WorkspaceGenerationLifecycle & {
      updateMapContributions(snapshot: unknown): void
      updateBasemapPresentation(presentation: unknown): void
    }
    const createWorkspace = vi.fn((_input: WorkspaceActivationOptions) => workspace)
    const readSnapshot = vi.fn(
      (_readInitialCenter: () => { readonly lat: number; readonly lon: number }) => null,
    )
    const composition = createWorkspaceRuntimeComposition({
      container: document.createElement('div'),
      appAdapter: createDetachedCanvasRuntimeAppAdapter(),
      targetPresentation: createDetachedSceneRuntimePanelTargetAdapter(),
      mapContributions: { read: () => null },
      readSnapshot,
      readBasemapPresentation: () => ({ basemapStyle: 'street', basemapVisible: true, basemapOpacity: 1 }),
    }, {
      createRendererComposition: () => ({
        renderer: { id: MAPLIBRE_SCENE_RENDERER_ID, initialize: vi.fn() },
        createLayer: vi.fn(),
        failActiveLayer: vi.fn(),
      }) as unknown as SharedMapSceneRendererComposition,
      createCamera: () => camera,
      createRuntime: () => runtime,
      createControls: () => ({
        createMap: vi.fn(),
        releaseMap: vi.fn(),
        getWebGL2Context: vi.fn(() => null),
        updateMapContributions: vi.fn(),
        updateBasemapPresentation: vi.fn(),
        installStyleRestorer: vi.fn(() => () => {}),
      }),
      createWorkspace,
    })
    return { composition, sessionPlane, refreshOrigin, createWorkspace, readSnapshot }
  }

  it('refreshes the camera origin whenever the runtime session plane changes, until disposal', async () => {
    const fixture = compositionFixture()
    await expect(fixture.composition.start()).resolves.toBe('no-design')
    expect(fixture.refreshOrigin).not.toHaveBeenCalled()

    fixture.sessionPlane.value = createSessionPlane({ lon: 2.3522, lat: 48.8566 })
    expect(fixture.refreshOrigin).toHaveBeenCalledOnce()

    fixture.sessionPlane.value = createSessionPlane({ lon: 2.6, lat: 48.9 })
    expect(fixture.refreshOrigin).toHaveBeenCalledTimes(2)

    await fixture.composition.dispose()
    fixture.sessionPlane.value = createSessionPlane({ lon: 3, lat: 49 })
    expect(fixture.refreshOrigin).toHaveBeenCalledTimes(2)
  })

  it('reads the live session plane origin for the workspace and the initial map centre', async () => {
    const fixture = compositionFixture()
    await fixture.composition.start()
    const readOrigin = fixture.createWorkspace.mock.calls[0]![0].readOrigin
    const readInitialCenter = fixture.readSnapshot.mock.calls[0]![0]

    expect(readOrigin()).toEqual({ lat: DEFAULT_NEW_DESIGN_VIEW.lat, lon: DEFAULT_NEW_DESIGN_VIEW.lon })
    expect(readInitialCenter()).toEqual({ lat: DEFAULT_NEW_DESIGN_VIEW.lat, lon: DEFAULT_NEW_DESIGN_VIEW.lon })

    fixture.sessionPlane.value = createSessionPlane({ lon: 2.3522, lat: 48.8566 })
    expect(readOrigin()).toEqual({ lat: 48.8566, lon: 2.3522 })
    expect(readInitialCenter()).toEqual({ lat: 48.8566, lon: 2.3522 })
    await fixture.composition.dispose()
  })
})
