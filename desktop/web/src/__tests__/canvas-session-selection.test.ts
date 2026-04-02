import { beforeEach, describe, expect, it } from 'vitest'
import { selectedObjectIds } from '../state/canvas'
import { CanvasSession } from '../canvas/session'
import { SceneCanvasRuntime } from '../canvas/runtime/scene-runtime'

describe('CanvasSession selection authority', () => {
  beforeEach(() => {
    selectedObjectIds.value = new Set()
  })

  it('delegates selection reads and writes to the runtime', () => {
    const runtime = new SceneCanvasRuntime()
    const session = new CanvasSession(runtime)

    runtime.getSceneStore().setSelection(['scene-1'])
    selectedObjectIds.value = new Set(['mirror-1'])

    expect(session.getSelection()).toEqual(new Set(['scene-1']))

    session.setSelection(['scene-2'])
    expect(runtime.getSceneStore().session.selectedEntityIds).toEqual(new Set(['scene-2']))
    expect(selectedObjectIds.value).toEqual(new Set(['scene-2']))
    expect(session.getSelection()).toEqual(new Set(['scene-2']))

    session.clearSelection()
    expect(runtime.getSceneStore().session.selectedEntityIds.size).toBe(0)
    expect(selectedObjectIds.value.size).toBe(0)
    expect(session.getSelection().size).toBe(0)
  })
})
