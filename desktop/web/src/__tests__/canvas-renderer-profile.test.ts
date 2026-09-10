import { describe, expect, it, vi } from 'vitest'
import { instrumentSceneRenderer } from '../canvas/runtime/renderers/profile'
import { createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'

describe('optional renderer profiling', () => {
  it('records bounded timing-only traces, preserves failures and unregisters on disposal', () => {
    const canvas = document.createElement('canvas')
    const failure = new Error('render failed')
    const renderScene = vi.fn()
    const dispose = vi.fn()
    const renderer = instrumentSceneRenderer(canvas, {
      id: 'canvas2d', resize: vi.fn(), renderScene, setViewport: () => { throw failure }, dispose,
    })
    const profile = window.__CANOPI_CANVAS_PROFILING__!.get(canvas)!
    renderer.renderScene(createTestSceneRendererSnapshot())
    expect(profile.stop().traceEvents).toEqual([])
    profile.start()
    renderer.renderScene(createTestSceneRendererSnapshot())
    expect(() => renderer.setViewport({ x: 0, y: 0, scale: 1 })).toThrow(failure)
    const trace = profile.stop()
    expect(trace.traceEvents.map(event => event.name)).toEqual(['scene', 'viewport'])
    expect(trace.metadata.backend).toBe('canvas2d')
    expect(JSON.stringify(trace)).not.toContain('plants')
    profile.start()
    for (let i = 0; i < 10005; i++) renderer.renderScene(createTestSceneRendererSnapshot())
    expect(profile.stop().dropped).toBe(5)
    renderer.dispose()
    expect(window.__CANOPI_CANVAS_PROFILING__!.has(canvas)).toBe(false)
    expect(dispose).toHaveBeenCalledOnce()
  })
})
