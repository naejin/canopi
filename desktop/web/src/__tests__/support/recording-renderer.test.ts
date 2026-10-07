import { describe, expect, it } from 'vitest'

import type { DraftPresentation } from '../../canvas/runtime/tools/draft'
import { createRecordingRenderer } from './recording-renderer'

describe('recording renderer', () => {
  it('records setDraft in call order', () => {
    const renderer = createRecordingRenderer()
    expect(renderer.lastDraft()).toBeNull()

    const draft: DraftPresentation = { shapes: [{ kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], style: { token: 'draft', widthPx: 2 } }] }
    // The recorder keeps the reference and reads nothing from it.
    renderer.setDraft(draft)
    expect(renderer.lastDraft()).toBe(draft)
    renderer.setDraft(null)

    expect(renderer.calls).toEqual([
      { method: 'setDraft', draft },
      { method: 'setDraft', draft: null },
    ])
    expect(renderer.lastDraft()).toBeNull()

    renderer.clear()
    expect(renderer.calls).toEqual([])
  })
})
