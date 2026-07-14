import { afterEach, describe, expect, it, vi } from 'vitest'

import { saveCanvasSelectionAsObjectStamp } from '../app/favorites/controller'
import { setCurrentCanvasSession } from '../canvas/session'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

describe('favorites controller', () => {
  afterEach(() => {
    setCurrentCanvasSession(null)
  })

  it('routes Saved Object Stamp capture through the mounted Scene command surface', () => {
    const saveSelectionAsObjectStamp = vi.fn()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        sceneEdits: { saveSelectionAsObjectStamp },
      }),
    }))

    saveCanvasSelectionAsObjectStamp()

    expect(saveSelectionAsObjectStamp).toHaveBeenCalledTimes(1)
  })
})
