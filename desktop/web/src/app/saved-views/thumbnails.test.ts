import { signal } from '@preact/signals'
import { afterEach, describe, expect, it } from 'vitest'
import { setCurrentCanvasSession } from '../../canvas/session'
import type { ViewScreen } from '../../canvas/runtime/view/types'
import type { SavedView } from '../../types/design'
import { createTestCanvasQuerySurface } from '../../__tests__/support/canvas-query-surface'
import { createTestCanvasRuntimeSurfaces } from '../../__tests__/support/canvas-runtime-surfaces'
import { savedViewThumbnailKey } from './thumbnails'

const VIEW: SavedView = {
  id: 'hedges',
  name: 'Hedges',
  camera: { lon: 13, lat: 23, zoom: 19, bearing: 30 },
  visible_layers: {
    background: { kind: 'none' },
    terrain: { contours: false, hillshade: false },
    scene_layers: ['plants'],
    site_data: [],
  },
  highlighted: { species: [], objects: [] },
  title: null,
  text: [],
}

/** A workspace whose live screen a test resizes, and whose settled frame it settles. */
function workspace(width: number, height: number) {
  const queries = createTestCanvasQuerySurface()
  const base = queries.view
  let screen: ViewScreen = { width, height, devicePixelRatio: 1 }
  const settledRevision = signal(0)
  const view = {
    ...base,
    settledRevision,
    captureView: () => ({ ...base.captureView(), screen }),
  }
  setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ queries: { ...queries, view } }))
  return {
    resize(nextWidth: number, nextHeight: number) {
      screen = { width: nextWidth, height: nextHeight, devicePixelRatio: 1 }
    },
    settle() { settledRevision.value += 1 },
  }
}

afterEach(() => { setCurrentCanvasSession(null) })

describe('saved view thumbnail key', () => {
  it('changes when the workspace size settles, since the thumbnail is fitted to it (spec §4.10)', () => {
    const host = workspace(1600, 900)
    const before = savedViewThumbnailKey(VIEW)

    host.resize(800, 450)
    host.settle()

    expect(savedViewThumbnailKey(VIEW)).not.toBe(before)
  })

  it('stays put during a drag-resize until the frame settles, and when a pan settles at the same size', () => {
    const host = workspace(1600, 900)
    const before = savedViewThumbnailKey(VIEW)

    host.settle()
    expect(savedViewThumbnailKey(VIEW)).toBe(before)

    host.resize(1200, 700)
    expect(savedViewThumbnailKey(VIEW)).toBe(before)
    host.resize(800, 450)
    expect(savedViewThumbnailKey(VIEW)).toBe(before)

    host.settle()
    const resized = savedViewThumbnailKey(VIEW)
    expect(resized).not.toBe(before)
    host.settle()
    expect(savedViewThumbnailKey(VIEW)).toBe(resized)
  })
})
