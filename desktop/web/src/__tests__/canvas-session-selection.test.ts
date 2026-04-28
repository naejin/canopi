import { beforeEach, describe, expect, it } from 'vitest'
import { currentCanvasReady, currentCanvasSession, setCurrentCanvasSession } from '../canvas/session'
import { SceneCanvasRuntime } from '../canvas/runtime/scene-runtime'
import { createCanvasRuntimeSurfaces } from '../canvas/runtime/surfaces'

describe('canvas session readiness', () => {
  beforeEach(() => {
    setCurrentCanvasSession(null)
  })

  it('tracks readiness from the published runtime surfaces', () => {
    const runtime = new SceneCanvasRuntime()
    const surfaces = createCanvasRuntimeSurfaces(runtime)

    setCurrentCanvasSession(surfaces)
    expect(currentCanvasSession.value).toBe(surfaces)
    expect(currentCanvasReady.value).toBe(true)

    setCurrentCanvasSession(null)
    expect(currentCanvasSession.value).toBe(null)
    expect(currentCanvasReady.value).toBe(false)
  })
})
