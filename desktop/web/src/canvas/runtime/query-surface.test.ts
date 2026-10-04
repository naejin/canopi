import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ipc/species', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../ipc/species')>(),
  getSpeciesBatch: vi.fn(async () => []),
  getFlowerColorBatch: vi.fn(async () => []),
  getCommonNames: vi.fn(async () => ({})),
}))

import {
  createSceneInteractionEventHarness,
  type SceneInteractionEventHarness,
} from '../../__tests__/support/canvas-interaction-events'
import { SceneCanvasRuntime } from './scene-runtime'
import type { PointerWorld } from './interaction-ports'

const harnesses: SceneInteractionEventHarness[] = []

afterEach(() => {
  for (const events of harnesses.splice(0)) events.dispose()
  document.body.replaceChildren()
})

async function mountedRuntime(): Promise<{ runtime: SceneCanvasRuntime, container: HTMLDivElement, events: SceneInteractionEventHarness }> {
  const renderer = { id: 'maplibre-pixi' as const, syncScene: vi.fn(), setView: vi.fn(), setDraft: vi.fn(), dispose: vi.fn() }
  const runtime = new SceneCanvasRuntime({ renderer: { id: 'test', initialize: () => renderer } })
  const container = document.createElement('div')
  document.body.appendChild(container)
  Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
  await runtime.init(container)
  const events = createSceneInteractionEventHarness(container)
  harnesses.push(events)
  return { runtime, container, events }
}

describe('the runtime query surface', () => {
  it('subscribePointerWorld hears the live interaction session over the map, and nothing once the map unmounts', async () => {
    const { runtime, container, events } = await mountedRuntime()
    const points: (PointerWorld | null)[] = []
    const stop = runtime.querySurface.subscribePointerWorld((point) => { points.push(point) })

    // A button-less move over the map itself is heard; one over the page beside it is not.
    events.pointerMove({ x: 100, y: 80 }, { target: container, buttons: 0 })
    events.pointerMove({ x: 110, y: 80 }, { target: document.body, buttons: 0 })
    const { frames } = runtime.cameraHost
    const expected = frames.viewFrame.peek().view.screenToWorld({ x: 100, y: 80 })
    expect(points).toHaveLength(1)
    expect(points[0]!.world.x).toBeCloseTo(expected!.x, 9)
    expect(points[0]!.world.y).toBeCloseTo(expected!.y, 9)
    expect(points[0]!.screen).toEqual({ x: 100, y: 80 })
    events.pointerLeave({ x: 100, y: 80 })
    expect(points.at(-1)).toBeNull()

    expect(runtime.keyboardPort).not.toBeNull()
    await runtime.unmountRenderer()
    expect(runtime.keyboardPort).toBeNull()
    events.pointerMove({ x: 120, y: 90 }, { target: container, buttons: 0 })
    expect(points).toHaveLength(2)
    stop()
    runtime.destroy()
  })
})
