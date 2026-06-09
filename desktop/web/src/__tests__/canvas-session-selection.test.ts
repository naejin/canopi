import { beforeEach, describe, expect, it } from 'vitest'
import { currentCanvasReady, currentCanvasSession, setCurrentCanvasSession } from '../canvas/session'
import { createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'

describe('canvas session readiness', () => {
  beforeEach(() => {
    setCurrentCanvasSession(null)
  })

  it('tracks readiness from the published runtime surfaces', () => {
    const surfaces = createTestCanvasRuntimeSurfaces()

    setCurrentCanvasSession(surfaces)
    expect(currentCanvasSession.value).toBe(surfaces)
    expect(currentCanvasReady.value).toBe(true)

    setCurrentCanvasSession(null)
    expect(currentCanvasSession.value).toBe(null)
    expect(currentCanvasReady.value).toBe(false)
  })
})
