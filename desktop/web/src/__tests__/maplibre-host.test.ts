import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    expect(maps[0]!.resize).toHaveBeenCalled()
    expect(resizeSync).toHaveBeenCalledWith(expect.objectContaining({ map: maps[0] }))

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

  it('rolls back constructor-owned container children after repeated create failures and supports retry', async () => {
    const host = createMapLibreHost({
      loadMapLibre: vi.fn(async () => maplibre),
    })
    const existingChild = document.createElement('div')
    const createError = new Error('WebGL is unavailable')
    const onCreateError = vi.fn()
    let attempts = 0
    const request: MapLibreHostRequest = {
      key: 'street',
      createMap: (api, target) => {
        attempts += 1
        if (attempts < 3) {
          target.append(document.createElement('canvas'), document.createElement('div'))
          throw createError
        }
        return new api.Map({
          container: target,
          style: { version: 8, sources: {}, layers: [] },
          interactive: false,
          pitchWithRotate: false,
          dragRotate: false,
          touchZoomRotate: false,
        })
      },
      onCreateError,
    }
    container.append(existingChild)

    host.attach(container)
    host.requestMap(request)
    await flushPromises()

    expect(onCreateError).toHaveBeenCalledWith(createError)
    expect(Array.from(container.children)).toEqual([existingChild])
    expect(host.current()).toBeNull()

    host.requestMap(request)
    await flushPromises()

    expect(onCreateError).toHaveBeenCalledTimes(2)
    expect(Array.from(container.children)).toEqual([existingChild])
    expect(host.current()).toBeNull()

    host.requestMap(request)
    await flushPromises()

    expect(host.current()?.map).toBe(maps[0])
    expect(Array.from(container.children)).toEqual([existingChild])

    host.destroy()

    expect(maps[0]!.remove).toHaveBeenCalledOnce()
    expect(Array.from(container.children)).toEqual([existingChild])
  })

  it('removes returned map constructor remnants on destroy without touching later container changes', async () => {
    const host = createMapLibreHost({
      loadMapLibre: vi.fn(async () => maplibre),
    })
    const existingChild = document.createElement('div')
    const laterChild = document.createElement('div')
    let attempts = 0
    const createdMap: { partial: FakeMap | null, retry: FakeMap | null } = {
      partial: null,
      retry: null,
    }
    container.append(existingChild)
    container.classList.add('existing-class')

    host.attach(container)
    host.requestMap({
      key: 'street',
      createMap: (_api, target) => {
        attempts += 1
        if (attempts === 1) {
          const wrapper = document.createElement('div')
          wrapper.append(document.createElement('canvas'))
          target.append(wrapper)
          target.classList.add('maplibregl-map')
          createdMap.partial = new FakeMap({
            container: target,
            style: { version: 8, sources: {}, layers: [] },
            interactive: false,
            pitchWithRotate: false,
            dragRotate: false,
            touchZoomRotate: false,
          })
          return createdMap.partial
        }
        createdMap.retry = new FakeMap({
          container: target,
          style: { version: 8, sources: {}, layers: [] },
          interactive: false,
          pitchWithRotate: false,
          dragRotate: false,
          touchZoomRotate: false,
        })
        return createdMap.retry
      },
    })
    await flushPromises()

    container.append(laterChild)
    container.classList.add('later-class')
    host.destroy()

    expect(createdMap.partial?.remove).toHaveBeenCalledOnce()
    expect(Array.from(container.children)).toEqual([existingChild, laterChild])
    expect(container.classList).toContain('existing-class')
    expect(container.classList).toContain('later-class')
    expect(container.classList).not.toContain('maplibregl-map')

    host.destroy()
    expect(createdMap.partial?.remove).toHaveBeenCalledOnce()

    host.attach(container)
    await flushPromises()

    expect(host.current()).not.toBeNull()
    host.destroy()
    expect(createdMap.retry?.remove).toHaveBeenCalledOnce()
    expect(Array.from(container.children)).toEqual([existingChild, laterChild])
  })

  it('rolls back returned constructor remnants after post-create failure even when map removal throws', async () => {
    const logError = vi.fn()
    const host = createMapLibreHost({
      loadMapLibre: vi.fn(async () => maplibre),
      logError,
    })
    const existingChild = document.createElement('div')
    const laterChild = document.createElement('div')
    const createError = new Error('post-create setup failed')
    const removeError = new Error('MapLibre removal failed')
    const onCreateError = vi.fn()
    const createdMap: { partial: FakeMap | null } = { partial: null }
    container.append(existingChild)
    container.classList.add('existing-class')

    host.attach(container)
    host.requestMap({
      key: 'street',
      createMap: (_api, target) => {
        const wrapper = document.createElement('div')
        wrapper.append(document.createElement('canvas'))
        target.append(wrapper)
        target.classList.add('maplibregl-map')
        createdMap.partial = new FakeMap({
          container: target,
          style: { version: 8, sources: {}, layers: [] },
          interactive: false,
          pitchWithRotate: false,
          dragRotate: false,
          touchZoomRotate: false,
        })
        createdMap.partial.remove.mockImplementation(() => {
          throw removeError
        })
        return createdMap.partial
      },
      onCreate: () => {
        container.append(laterChild)
        container.classList.add('later-class')
        throw createError
      },
      onCreateError,
    })
    await flushPromises()

    expect(createdMap.partial?.remove).toHaveBeenCalledOnce()
    expect(onCreateError).toHaveBeenCalledWith(createError)
    expect(logError).toHaveBeenCalledWith(
      'Failed to remove MapLibre map after create failure:',
      removeError,
    )
    expect(Array.from(container.children)).toEqual([existingChild, laterChild])
    expect(container.classList).toContain('existing-class')
    expect(container.classList).toContain('later-class')
    expect(container.classList).not.toContain('maplibregl-map')
  })

  it('rolls back returned constructor remnants when a synchronous creation is stale', async () => {
    const host = createMapLibreHost({
      loadMapLibre: vi.fn(async () => maplibre),
    })
    const existingChild = document.createElement('div')
    const createdMap: { partial: FakeMap | null } = { partial: null }
    container.append(existingChild)
    container.classList.add('existing-class')

    host.attach(container)
    host.requestMap({
      key: 'street',
      createMap: (_api, target) => {
        const wrapper = document.createElement('div')
        wrapper.append(document.createElement('canvas'))
        target.append(wrapper)
        target.classList.add('maplibregl-map')
        host.destroy()
        createdMap.partial = new FakeMap({
          container: target,
          style: { version: 8, sources: {}, layers: [] },
          interactive: false,
          pitchWithRotate: false,
          dragRotate: false,
          touchZoomRotate: false,
        })
        return createdMap.partial
      },
    })
    await flushPromises()

    expect(createdMap.partial?.remove).toHaveBeenCalledOnce()
    expect(Array.from(container.children)).toEqual([existingChild])
    expect(container.classList).toContain('existing-class')
    expect(container.classList).not.toContain('maplibregl-map')
    expect(host.current()).toBeNull()
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
