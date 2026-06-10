import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMapLibreSurfaceAdapter } from '../maplibre/surface-adapter'
import type {
  MapLibreApi,
  MapLibreMapConstructorOptions,
  MapLibreMapInstance,
} from '../maplibre/loader'

type MapEventHandler = (event?: unknown) => void

class FakeMap implements MapLibreMapInstance {
  readonly jumpTo = vi.fn()
  readonly resize = vi.fn()
  readonly remove = vi.fn()
  readonly on = vi.fn((type: string, listener: MapEventHandler) => {
    const listeners = this.handlers.get(type) ?? new Set()
    listeners.add(listener)
    this.handlers.set(type, listeners)
  })
  readonly off = vi.fn((type: string, listener: MapEventHandler) => {
    this.handlers.get(type)?.delete(listener)
  })
  readonly addSource = vi.fn()
  readonly getSource = vi.fn()
  readonly removeSource = vi.fn()
  readonly addLayer = vi.fn()
  readonly setPaintProperty = vi.fn()
  readonly getLayer = vi.fn()
  readonly removeLayer = vi.fn()
  readonly handlers = new Map<string, Set<MapEventHandler>>()

  constructor(readonly options: MapLibreMapConstructorOptions) {}

  emit(type: string, event?: unknown): void {
    for (const listener of this.handlers.get(type) ?? []) listener(event)
  }
}

class FakeResizeObserver {
  readonly observe = vi.fn()
  readonly disconnect = vi.fn()

  constructor(readonly callback: ResizeObserverCallback) {}
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

describe('MapLibre surface adapter', () => {
  let container: HTMLDivElement
  let maps: FakeMap[]
  let maplibre: MapLibreApi
  let observers: FakeResizeObserver[]

  beforeEach(() => {
    container = document.createElement('div')
    maps = []
    observers = []
    maplibre = createFakeMapLibreApi(maps)
  })

  it('owns typed map access, map events, cleanup callbacks, and resize routing', async () => {
    const adapter = createMapLibreSurfaceAdapter<FakeMap>({
      loadMapLibre: vi.fn(async () => maplibre),
      createResizeObserver: (callback) => {
        const observer = new FakeResizeObserver(callback)
        observers.push(observer)
        return observer
      },
    })
    const onMove = vi.fn()
    const cleanup = vi.fn()

    adapter.attach(container)
    adapter.requestMap({
      key: 'street',
      createMap: (api, target) => new api.Map({
        container: target,
        style: { version: 8, sources: {}, layers: [] },
        interactive: false,
        pitchWithRotate: false,
        dragRotate: false,
        touchZoomRotate: false,
      }) as FakeMap,
      onCreate: (context) => {
        context.lifetime.on('move', onMove)
        context.lifetime.addCleanup(cleanup)
      },
      onResize: (context) => {
        context.map.emit('move')
      },
    })
    await flushPromises()

    expect(adapter.map).toBe(maps[0])
    expect(adapter.maplibre).toBe(maplibre)
    expect(adapter.current()?.map).toBe(maps[0])

    maps[0]!.emit('move')
    expect(onMove).toHaveBeenCalledTimes(1)

    observers[0]!.callback([], {} as ResizeObserver)
    expect(maps[0]!.resize).toHaveBeenCalled()
    expect(onMove).toHaveBeenCalledTimes(2)

    adapter.destroy()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(maps[0]!.off).toHaveBeenCalledWith('move', onMove)
    expect(maps[0]!.remove).toHaveBeenCalled()
    expect(adapter.map).toBeNull()
  })

  it('cleans surface lifetime resources when post-create setup fails', async () => {
    const logError = vi.fn()
    const adapter = createMapLibreSurfaceAdapter<FakeMap>({
      loadMapLibre: vi.fn(async () => maplibre),
      logError,
    })
    const onMove = vi.fn()
    const cleanup = vi.fn()
    const onCreateError = vi.fn()
    const setupError = new Error('setup failed')

    adapter.attach(container)
    adapter.requestMap({
      key: 'street',
      createMap: (api, target) => new api.Map({
        container: target,
        style: { version: 8, sources: {}, layers: [] },
        interactive: false,
        pitchWithRotate: false,
        dragRotate: false,
        touchZoomRotate: false,
      }) as FakeMap,
      onCreate: (context) => {
        context.lifetime.on('move', onMove)
        context.lifetime.addCleanup(cleanup)
        throw setupError
      },
      onCreateError,
    })
    await flushPromises()

    expect(onCreateError).toHaveBeenCalledWith(setupError)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(maps[0]!.off).toHaveBeenCalledWith('move', onMove)
    expect(maps[0]!.remove).toHaveBeenCalled()
    expect(adapter.map).toBeNull()
    expect(logError).not.toHaveBeenCalled()
  })
})
