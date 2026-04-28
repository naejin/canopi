import { beforeEach, describe, expect, it, vi } from 'vitest'
import { currentCanvasReady, currentCanvasSession, currentCanvasTool, getCurrentCanvasSession, setCurrentCanvasSession, setCurrentCanvasTool } from '../canvas/session'
import { SceneCanvasRuntime } from '../canvas/runtime/scene-runtime'
import { createCanvasRuntimeSurfaces } from '../canvas/runtime/surfaces'
import type { CanvasRuntime } from '../canvas/runtime/runtime'

describe('canvas session seam', () => {
  beforeEach(() => {
    setCurrentCanvasSession(null)
    setCurrentCanvasTool('select')
  })

  it('stores explicit runtime surfaces for the live runtime', () => {
    const runtime = new SceneCanvasRuntime()
    const surfaces = createCanvasRuntimeSurfaces(runtime)

    setCurrentCanvasSession(surfaces)

    expect(getCurrentCanvasSession()).toBe(surfaces)
    expect(currentCanvasSession.value).toBe(surfaces)
    expect(currentCanvasReady.value).toBe(true)

    setCurrentCanvasSession(null)

    expect(currentCanvasSession.value).toBe(null)
    expect(currentCanvasReady.value).toBe(false)
  })

  it('primes tool state before mount and delegates to the runtime after mount', () => {
    setCurrentCanvasTool('rectangle')
    expect(currentCanvasTool.value).toBe('rectangle')

    const setTool = vi.fn()
    const runtime = { setTool } as unknown as CanvasRuntime

    setCurrentCanvasSession(runtime)
    setCurrentCanvasTool('hand')

    expect(setTool).toHaveBeenCalledWith('hand')
    expect(currentCanvasTool.value).toBe('hand')
  })
})
