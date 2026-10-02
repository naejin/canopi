import { describe, expect, it } from 'vitest'

import type { DraftPresentation } from '../../canvas/runtime/tools/draft'
import type { ViewTransform } from '../../canvas/runtime/view/types'
import { createRecordingRenderer } from './recording-renderer'

describe('recording renderer', () => {
  it('records setDraft and setView in call order', () => {
    const renderer = createRecordingRenderer()
    expect(renderer.lastDraft()).toBeNull()
    expect(renderer.lastView()).toBeNull()

    const draft: DraftPresentation = { shapes: [{ kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], style: { token: 'draft', widthPx: 2 } }] }
    // The recorder keeps the reference and reads nothing from it.
    const view = { revision: 1 } as unknown as ViewTransform
    renderer.setView(view)
    renderer.setDraft(draft)
    renderer.setDraft(null)

    expect(renderer.calls).toEqual([
      { method: 'setView', view },
      { method: 'setDraft', draft },
      { method: 'setDraft', draft: null },
    ])
    expect(renderer.lastDraft()).toBeNull()
    expect(renderer.lastView()).toBe(view)

    renderer.clear()
    expect(renderer.calls).toEqual([])
  })
})
