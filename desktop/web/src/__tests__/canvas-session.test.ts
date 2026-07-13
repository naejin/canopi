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
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

describe('canvas session seam', () => {
  beforeEach(() => {
    setCurrentCanvasSession(null)
    setCurrentCanvasTool('select')
  })

  it('stores explicit runtime surfaces for the live runtime', () => {
    const surfaces = createTestCanvasRuntimeSurfaces()

    setCurrentCanvasSession(surfaces)

    expect(getCurrentCanvasSession()).toBe(surfaces)
    expect(currentCanvasSession.value).toBe(surfaces)
    expect(currentCanvasReady.value).toBe(true)

    setCurrentCanvasSession(null)

    expect(currentCanvasSession.value).toBe(null)
    expect(currentCanvasReady.value).toBe(false)
  })

  it('rejects mounted runtime publication until it is adapted into explicit surfaces', () => {
    expect(() => setCurrentCanvasSession({ commandSurface: {} } as never)).toThrow(
      /explicit canvas runtime surfaces/,
    )
    expect(currentCanvasSession.value).toBe(null)
    expect(currentCanvasReady.value).toBe(false)
  })

  it('primes tool state before mount and delegates through the command surface after mount', () => {
    setCurrentCanvasTool('rectangle')
    expect(currentCanvasTool.value).toBe('rectangle')

    const setTool = vi.fn((name: string) => {
      currentCanvasTool.value = name
    })
    const surfaces = createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        tools: {
          setTool,
        },
      }),
    })
    setCurrentCanvasSession(surfaces)
    setCurrentCanvasTool('hand')

    expect(getCurrentCanvasCommandSurface()).toBe(currentCanvasSession.value?.commands)
    expect(getCurrentCanvasToolCommandSurface()).toBe(currentCanvasSession.value?.commands.tools)
    expect(setTool).toHaveBeenCalledWith('hand')
    expect(currentCanvasTool.value).toBe('hand')
  })

  it('does not pre-publish a mounted tool change that the command surface rejects', () => {
    setCurrentCanvasTool('rectangle')
    const setTool = vi.fn(() => {
      throw new Error('tool transition failed')
    })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({ tools: { setTool } }),
    }))

    expect(() => setCurrentCanvasTool('hand')).toThrow('tool transition failed')

    expect(setTool).toHaveBeenCalledWith('hand')
    expect(currentCanvasTool.value).toBe('rectangle')
  })
})
