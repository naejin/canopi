import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMapLibreHost,
  type MapLibreHostRequest,
  type MapLibreHostViewState,
} from '../maplibre/host'
import type {
  MapLibreApi,
  MapLibreMapConstructorOptions,
  MapLibreMapInstance,
} from '../maplibre/loader'

class FakeMap implements MapLibreMapInstance {
  readonly jumpTo = vi.fn()
  readonly resize = vi.fn()
  readonly remove = vi.fn()
  readonly on = vi.fn()
  readonly off = vi.fn()
  readonly addSource = vi.fn()
  readonly getSource = vi.fn()
  readonly removeSource = vi.fn()
  readonly addLayer = vi.fn()
  readonly setPaintProperty = vi.fn()
  readonly getLayer = vi.fn()
  readonly removeLayer = vi.fn()
  readonly getLayersOrder = vi.fn(() => [])
  readonly moveLayer = vi.fn()

  constructor(readonly options: MapLibreMapConstructorOptions) {}
}

class FakeResizeObserver {
  readonly observe = vi.fn()
  readonly disconnect = vi.fn()

  constructor(readonly callback: ResizeObserverCallback) {}

  emit(): void {
    this.callback([], this as unknown as ResizeObserver)
  }
}

function createFakeMapLibreApi(maps: FakeMap[]): MapLibreApi {
  class TestMap extends FakeMap {
    constructor(options: MapLibreMapConstructorOptions) {
      super(options)
      maps.push(this)
    }
  }

  return {
    Map: TestMap,
    addProtocol: vi.fn(),
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('MapLibre Host', () => {
  let container: HTMLDivElement
  let maps: FakeMap[]
  let observers: FakeResizeObserver[]
  let maplibre: MapLibreApi

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    container = document.createElement('div')
    maps = []
    observers = []
    maplibre = createFakeMapLibreApi(maps)
  })

  it('owns MapLibre creation, resize observation, teardown, and preserved view state', async () => {
    const host = createMapLibreHost({
      loadMapLibre: vi.fn(async () => maplibre),
      createResizeObserver: (callback) => {
        const observer = new FakeResizeObserver(callback)
        observers.push(observer)
        return observer
      },
    })
    const createdWithViewState: Array<MapLibreHostViewState | null> = []
    const resizeSync = vi.fn()

    host.attach(container)
    host.requestMap({
      key: 'street',
      createMap: (api, target, preservedViewState) => {
        createdWithViewState.push(preservedViewState)
        return new api.Map({
          container: target,
          style: { version: 8, sources: {}, layers: [] },
          interactive: false,
          pitchWithRotate: false,
          dragRotate: false,
          touchZoomRotate: false,
        })
      },
      captureViewState: () => ({
        center: [1, 2],
        zoom: 3,
        bearing: 4,
      }),
      onResize: resizeSync,
    })
    await flushPromises()

    expect(maps).toHaveLength(1)
    expect(createdWithViewState).toEqual([null])
    expect(observers).toHaveLength(1)
    expect(observers[0]!.observe).toHaveBeenCalledWith(container)

    observers[0]!.emit()
    expect(maps[0]!.resize).not.toHaveBeenCalled()
    expect(resizeSync).toHaveBeenCalledWith(expect.objectContaining({ map: maps[0] }), { width: 0, height: 0 })

    host.requestMap({
      key: 'satellite',
      createMap: (api, target, preservedViewState) => {
        createdWithViewState.push(preservedViewState)
        return new api.Map({
          container: target,
          style: { version: 8, sources: {}, layers: [] },
          interactive: false,
          pitchWithRotate: false,
          dragRotate: false,
          touchZoomRotate: false,
        })
      },
      captureViewState: () => null,
    })
    await flushPromises()

    expect(maps[0]!.remove).toHaveBeenCalled()
    expect(maps).toHaveLength(2)
    expect(createdWithViewState).toEqual([
      null,
      { center: [1, 2], zoom: 3, bearing: 4 },
    ])

    host.destroy()
    expect(observers[1]!.disconnect).toHaveBeenCalled()
    expect(maps[1]!.remove).toHaveBeenCalled()
  })

  it("a resize calls the surface request's resize hook, not map.resize", async () => {
    const host = createMapLibreHost({
      loadMapLibre: vi.fn(async () => maplibre),
      createResizeObserver: (callback) => {
        const observer = new FakeResizeObserver(callback)
        observers.push(observer)
        return observer
      },
    })
    let size = { width: 640, height: 480 }
    Object.defineProperties(container, {
      clientWidth: { get: () => size.width },
      clientHeight: { get: () => size.height },
    })
    const createMap = (api: MapLibreApi, target: HTMLElement) => new api.Map({
      container: target,
      style: { version: 8, sources: {}, layers: [] },
      interactive: false,
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: false,
    })
    const onResize = vi.fn()

    host.attach(container)
    host.requestMap({ key: 'workspace', createMap, onResize })
    await flushPromises()
    observers[0]!.emit()

    // The request owns its map's resize (spec §1.1 "Resize"); the host reports the container's CSS size.
    expect(onResize).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenCalledWith(expect.objectContaining({ map: maps[0] }), { width: 640, height: 480 })
    expect(maps[0]!.resize).not.toHaveBeenCalled()

    size = { width: 320, height: 200 }
    host.resize()
    expect(onResize).toHaveBeenLastCalledWith(expect.objectContaining({ map: maps[0] }), { width: 320, height: 200 })

    // A request without a hook: nothing resizes its map.
    host.requestMap({ key: 'other', createMap })
    await flushPromises()
    observers[1]!.emit()
    expect(maps[1]!.resize).not.toHaveBeenCalled()
    expect(onResize).toHaveBeenCalledTimes(2)
    host.destroy()
  })

  it('tears down partially initialized maps when post-create setup fails', async () => {
    const host = createMapLibreHost({
      loadMapLibre: vi.fn(async () => maplibre),
      createResizeObserver: (callback) => {
        const observer = new FakeResizeObserver(callback)
        observers.push(observer)
        return observer
      },
    })
    const onCreateError = vi.fn()
    const onDestroy = vi.fn()

    host.attach(container)
    host.requestMap({
      key: 'street',
      createMap: (api, target) => new api.Map({
        container: target,
        style: { version: 8, sources: {}, layers: [] },
        interactive: false,
        pitchWithRotate: false,
        dragRotate: false,
        touchZoomRotate: false,
      }),
      onCreate: () => {
        throw new Error('post-create setup failed')
      },
      onDestroy,
      onCreateError,
    })
    await flushPromises()

    expect(onCreateError).toHaveBeenCalledWith(expect.any(Error))
    expect(host.current()).toBeNull()
    expect(observers[0]!.disconnect).toHaveBeenCalled()
    expect(onDestroy).toHaveBeenCalledWith(expect.objectContaining({ map: maps[0] }))
    expect(maps[0]!.remove).toHaveBeenCalled()

    host.requestMap({
      key: 'street',
      createMap: (api, target) => new api.Map({
        container: target,
        style: { version: 8, sources: {}, layers: [] },
        interactive: false,
        pitchWithRotate: false,
        dragRotate: false,
        touchZoomRotate: false,
      }),
    })
    await flushPromises()

    expect(maps).toHaveLength(2)
    expect(host.current()?.map).toBe(maps[1])
  })

  it('still removes failed maps and reports create errors when post-create cleanup throws', async () => {
    const logError = vi.fn()
    const host = createMapLibreHost({
      loadMapLibre: vi.fn(async () => maplibre),
      logError,
    })
    const createError = new Error('post-create setup failed')
    const cleanupError = new Error('adapter cleanup failed')
    const onCreateError = vi.fn()

    host.attach(container)
    host.requestMap({
      key: 'street',
      createMap: (api, target) => new api.Map({
        container: target,
        style: { version: 8, sources: {}, layers: [] },
        interactive: false,
        pitchWithRotate: false,
        dragRotate: false,
        touchZoomRotate: false,
      }),
      onCreate: () => {
        throw createError
      },
      onDestroy: () => {
        throw cleanupError
      },
      onCreateError,
    })
    await flushPromises()

    expect(maps[0]!.remove).toHaveBeenCalled()
    expect(onCreateError).toHaveBeenCalledWith(createError)
    expect(logError).toHaveBeenCalledWith(
      'Failed to clean up MapLibre map after create failure:',
      cleanupError,
    )
    expect(host.current()).toBeNull()
  })

  it('logs a failed map removal after a post-create failure, still removes what its constructor added, and reports the create error', async () => {
    const logError = vi.fn()
    const host = createMapLibreHost({
      loadMapLibre: vi.fn(async () => maplibre),
      logError,
    })
    const createError = new Error('post-create setup failed')
    const removeError = new Error('MapLibre removal failed')
    const onCreateError = vi.fn()
    const existingChild = document.createElement('div')
    container.append(existingChild)

    host.attach(container)
    host.requestMap({
      key: 'street',
      createMap: (api, target) => {
        target.append(document.createElement('canvas'))
        target.classList.add('maplibregl-map')
        const map = new api.Map({
          container: target,
          style: { version: 8, sources: {}, layers: [] },
          interactive: false,
          pitchWithRotate: false,
          dragRotate: false,
          touchZoomRotate: false,
        }) as FakeMap
        map.remove.mockImplementation(() => {
          throw removeError
        })
        return map
      },
      onCreate: () => {
        throw createError
      },
      onCreateError,
    })
    await flushPromises()

    expect(maps[0]!.remove).toHaveBeenCalledOnce()
    expect(onCreateError).toHaveBeenCalledWith(createError)
    expect(logError).toHaveBeenCalledWith(
      'Failed to remove MapLibre map after create failure:',
      removeError,
    )
    expect(Array.from(container.children)).toEqual([existingChild])
    expect(container.classList).not.toContain('maplibregl-map')
    expect(host.current()).toBeNull()
  })

  it('removes what a request built in the container before its createMap threw, so a retry starts clean', async () => {
    // The World map configures its map after the constructor returns; a throw there never hands the host the map.
    const host = createMapLibreHost({ loadMapLibre: vi.fn(async () => maplibre) })
    const existingChild = document.createElement('div')
    container.append(existingChild)
    const onCreateError = vi.fn()
    const request: MapLibreHostRequest = {
      key: 'world',
      createMap: (_api, target) => {
        target.append(document.createElement('div'))
        target.classList.add('maplibregl-map')
        throw new Error('keyboard handler unavailable')
      },
      onCreateError,
    }

    host.attach(container)
    host.requestMap(request)
    await flushPromises()
    host.requestMap(request)
    await flushPromises()

    expect(onCreateError).toHaveBeenCalledTimes(2)
    expect(Array.from(container.children)).toEqual([existingChild])
    expect(container.classList).not.toContain('maplibregl-map')
  })

  it('removes a map whose synchronous creation went stale', async () => {
    const host = createMapLibreHost({
      loadMapLibre: vi.fn(async () => maplibre),
    })

    host.attach(container)
    host.requestMap({
      key: 'street',
      createMap: (api, target) => {
        host.destroy()
        return new api.Map({
          container: target,
          style: { version: 8, sources: {}, layers: [] },
          interactive: false,
          pitchWithRotate: false,
          dragRotate: false,
          touchZoomRotate: false,
        })
      },
    })
    await flushPromises()

    expect(maps[0]!.remove).toHaveBeenCalledOnce()
    expect(host.current()).toBeNull()
  })

  it.each([
    // jsdom has no WebGL: the painter throws, and MapLibre removes its own containers (`_cleanupContainer`).
    ['without WebGL', false, undefined, /WebGL|context/i],
    // With a painter, a later constructor step throws and MapLibre leaves its canvas and controls behind.
    ['after its painter was set up', true, [Number.NaN, Number.NaN] as [number, number], /Invalid LngLat/],
  ])('leaves the container as it was when the real MapLibre constructor fails %s, and a retry tries again', async (_case, painter, center, failure) => {
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL() { return 'blob:map-worker' }
    })
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const realMapLibre = await import('maplibre-gl') as unknown as MapLibreApi
    const realMap = realMapLibre.Map as unknown as { prototype: { _setupPainter(): void } }
    if (painter) vi.spyOn(realMap.prototype, '_setupPainter').mockImplementation(() => {})
    const logError = vi.fn()
    const host = createMapLibreHost({ loadMapLibre: async () => realMapLibre, logError })
    const existingChild = document.createElement('div')
    container.append(existingChild)
    container.classList.add('existing-class')
    const onCreateError = vi.fn()
    const request: MapLibreHostRequest = {
      key: 'street',
      createMap: (api, target) => new api.Map({
        container: target,
        style: { version: 8, sources: {}, layers: [] },
        center,
        interactive: false,
        pitchWithRotate: false,
        dragRotate: false,
        touchZoomRotate: false,
      }),
      onCreateError,
    }

    host.attach(container)
    host.requestMap(request)
    await vi.waitFor(() => expect(onCreateError).toHaveBeenCalledTimes(1))
    expect(String(onCreateError.mock.calls[0]![0])).toMatch(failure)

    expect(Array.from(container.children)).toEqual([existingChild])
    expect(Array.from(container.classList)).toEqual(['existing-class'])
    expect(host.current()).toBeNull()

    host.requestMap(request)
    await vi.waitFor(() => expect(onCreateError).toHaveBeenCalledTimes(2))

    expect(Array.from(container.children)).toEqual([existingChild])
    expect(Array.from(container.classList)).toEqual(['existing-class'])
    expect(host.current()).toBeNull()
    expect(logError).not.toHaveBeenCalled()
  })

  it('does not create a map after its pending load is cancelled', async () => {
    const pendingLoad: { resolveMapLibre: ((api: MapLibreApi) => void) | null } = {
      resolveMapLibre: null,
    }
    const host = createMapLibreHost({
      loadMapLibre: () => new Promise((resolve) => {
        pendingLoad.resolveMapLibre = resolve
      }),
    })
    const createMap = vi.fn()

    host.attach(container)
    host.requestMap({
      key: 'street',
      createMap,
    })
    host.destroy()
    pendingLoad.resolveMapLibre?.(maplibre)
    await flushPromises()

    expect(createMap).not.toHaveBeenCalled()
    expect(host.current()).toBeNull()
  })
})
