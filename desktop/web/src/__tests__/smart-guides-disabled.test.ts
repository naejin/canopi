import { beforeEach, describe, expect, it, vi } from 'vitest'

const guidesMocks = vi.hoisted(() => ({
  snapToGuides: vi.fn((x: number, y: number) => ({ x, y })),
  createGuideLine: vi.fn(),
}))

vi.mock('../canvas/guides', async () => {
  const actual = await vi.importActual<typeof import('../canvas/guides')>('../canvas/guides')
  return {
    ...actual,
    snapToGuides: guidesMocks.snapToGuides,
    createGuideLine: guidesMocks.createGuideLine,
  }
})

import { CanvasEngine } from '../canvas/engine'

describe('CanvasEngine drag snapping', () => {
  beforeEach(() => {
    guidesMocks.snapToGuides.mockClear()
    guidesMocks.createGuideLine.mockClear()
  })

  it('does not auto-align dragged objects to peer nodes or create smart-guide lines', () => {
    const listeners = new Map<string, (event: any) => void>()
    const layer = {
      add: vi.fn(),
      batchDraw: vi.fn(),
    } as any
    const target = {
      _x: 113,
      _y: 57,
      x: () => target._x,
      y: () => target._y,
      position: ({ x, y }: { x: number; y: number }) => {
        target._x = x
        target._y = y
      },
      getLayer: () => layer,
    } as any
    const engine = {
      stage: {
        on: vi.fn((event: string, handler: (payload: any) => void) => {
          listeners.set(event, handler)
        }),
      },
    } as any

    CanvasEngine.prototype['_setupSnapToDrag'].call(engine)
    listeners.get('dragmove')?.({ target })

    expect(target.x()).toBe(113)
    expect(target.y()).toBe(57)
    expect(layer.add).not.toHaveBeenCalled()
    expect(layer.batchDraw).toHaveBeenCalledTimes(1)
  })
})
