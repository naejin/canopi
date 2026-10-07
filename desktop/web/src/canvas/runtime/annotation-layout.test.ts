import { expect, it, vi } from 'vitest'
import { getAnnotationPresentation } from './annotation-layout'
import type { SceneAnnotationEntity } from './scene'

// A 2D context whose glyphs are half an em wide, on a page with no font loading API (jsdom has none).
vi.stubGlobal('OffscreenCanvas', class {
  getContext() {
    return {
      font: '',
      measureText(this: { font: string }, text: string) {
        const width = text.length * Number(/([\d.]+)px/.exec(this.font)![1]) * 0.5
        return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width }
      },
    }
  }
})

it('a page that cannot say when the web font arrives keeps the estimate, even with an OffscreenCanvas to measure in', () => {
  expect(document.fonts).toBeUndefined()
  const note: SceneAnnotationEntity = { kind: 'annotation', id: 'note', annotationType: 'text', position: { x: 0, y: 0 },
    text: 'Pond', fontSize: 10, rotationDeg: 0, locked: false }
  // 4 glyphs at 10 px, 0.6 em each, not the 20 px a fallback font would give for good.
  expect(getAnnotationPresentation(note, 20, true).textFrame.widthPx).toBeCloseTo(24, 9)
})
