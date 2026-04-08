import { beforeEach, describe, expect, it } from 'vitest'
import { currentCanvasReady, currentCanvasSession, setCurrentCanvasSession } from '../canvas/session'
import { SceneCanvasRuntime } from '../canvas/runtime/scene-runtime'

describe('canvas session readiness', () => {
  beforeEach(() => {
    setCurrentCanvasSession(null)
  })

  it('tracks readiness directly from the mounted runtime signal', () => {
    const runtime = new SceneCanvasRuntime()

    setCurrentCanvasSession(runtime)
    expect(currentCanvasSession.value).toBe(runtime)
    expect(currentCanvasReady.value).toBe(true)

    setCurrentCanvasSession(null)
    expect(currentCanvasSession.value).toBe(null)
    expect(currentCanvasReady.value).toBe(false)
  })
})
