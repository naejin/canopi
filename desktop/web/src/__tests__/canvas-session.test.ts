import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  currentCanvasReady,
  currentCanvasSession,
  currentCanvasTool,
  getCurrentCanvasCommandSurface,
  getCurrentCanvasSession,
  getCurrentCanvasToolCommandSurface,
  setCurrentCanvasSession,
  setCurrentCanvasTool,
} from '../canvas/session'
import { SceneCanvasRuntime } from '../canvas/runtime/scene-runtime'
import { createCanvasRuntimeSurfaces } from '../canvas/runtime/surfaces'

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

  it('rejects mounted runtime publication until it is adapted into explicit surfaces', () => {
    const runtime = new SceneCanvasRuntime()

    try {
      expect(() => setCurrentCanvasSession(runtime as never)).toThrow(
        /explicit canvas runtime surfaces/,
      )
      expect(currentCanvasSession.value).toBe(null)
      expect(currentCanvasReady.value).toBe(false)
    } finally {
      runtime.destroy()
    }
  })

  it('primes tool state before mount and delegates through the command surface after mount', () => {
    setCurrentCanvasTool('rectangle')
    expect(currentCanvasTool.value).toBe('rectangle')

    const setTool = vi.fn()
    const runtime = new SceneCanvasRuntime()
    const surfaces = createCanvasRuntimeSurfaces(runtime)

    try {
      setCurrentCanvasSession({
        ...surfaces,
        commands: {
          ...surfaces.commands,
          tools: {
            ...surfaces.commands.tools,
            setTool,
          },
        },
      })
      setCurrentCanvasTool('hand')

      expect(getCurrentCanvasCommandSurface()).toBe(currentCanvasSession.value?.commands)
      expect(getCurrentCanvasToolCommandSurface()).toBe(currentCanvasSession.value?.commands.tools)
      expect(setTool).toHaveBeenCalledWith('hand')
      expect(currentCanvasTool.value).toBe('hand')
    } finally {
      runtime.destroy()
    }
  })
})
