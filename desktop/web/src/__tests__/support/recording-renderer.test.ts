import { describe, expect, it } from 'vitest'

import type { DraftPresentation, SelectionPreview } from '../../canvas/runtime/tools/draft'
import type { ViewTransform } from '../../canvas/runtime/view/types'
import { createRecordingRenderer } from './recording-renderer'

describe('recording renderer', () => {
  it('records setDraft, setSelectionPreview and setView in call order', () => {
    const renderer = createRecordingRenderer()
    expect(renderer.lastDraft()).toBeNull()
    expect(renderer.lastSelectionPreview()).toBeNull()
    expect(renderer.lastView()).toBeNull()

    const draft: DraftPresentation = { shapes: [{ kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], style: { token: 'draft', widthPx: 2 } }] }
    const preview: SelectionPreview = { translate: { x: 2, y: 0 }, rotateDeg: 0, pivot: { x: 0, y: 0 } }
    // The recorder keeps the reference and reads nothing from it.
    const view = { revision: 1 } as unknown as ViewTransform
    renderer.setView(view)
    renderer.setDraft(draft)
    renderer.setSelectionPreview(preview)
    renderer.setDraft(null)

    expect(renderer.calls).toEqual([
      { method: 'setView', view },
      { method: 'setDraft', draft },
      { method: 'setSelectionPreview', preview },
      { method: 'setDraft', draft: null },
    ])
    expect(renderer.lastDraft()).toBeNull()
    expect(renderer.lastSelectionPreview()).toBe(preview)
    expect(renderer.lastView()).toBe(view)

    renderer.clear()
    expect(renderer.calls).toEqual([])
    expect(renderer.lastSelectionPreview()).toBeNull()
  })
})
