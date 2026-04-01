import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SelectTool } from '../canvas/tools/select'
import { selectedObjectIds, lockedObjectIds } from '../state/canvas'

function makeNode(id: string, x: number, y: number) {
  const layer = {
    batchDraw: vi.fn(),
  } as any
  const attrs: Record<string, unknown> = {}
  const node = {
    _x: x,
    _y: y,
    id: () => id,
    x: () => node._x,
    y: () => node._y,
    position: ({ x: nextX, y: nextY }: { x: number; y: number }) => {
      node._x = nextX
      node._y = nextY
    },
    hasName: (name: string) => name === 'shape',
    getParent: () => null,
    getClassName: () => 'Rect',
    getLayer: () => layer,
    setAttr: (name: string, value: unknown) => {
      attrs[name] = value
    },
    getAttr: (name: string) => attrs[name],
    setAttrs: (nextAttrs: Record<string, unknown>) => {
      Object.assign(attrs, nextAttrs)
    },
  }

  return { node: node as any, layer }
}

function makeEngine(nodes: any[] = []) {
  const stage = {
    on: vi.fn(),
    off: vi.fn(),
    container: () => document.createElement('div'),
    draggable: () => false,
    getRelativePointerPosition: vi.fn(() => ({ x: 0, y: 0 })),
  } as any
  const annotationsLayer = {
    add: vi.fn(),
    batchDraw: vi.fn(),
    find: vi.fn(() => []),
    findOne: vi.fn(() => null),
  } as any
  const zonesLayer = {
    find: vi.fn((selector: string) => (selector === '.shape' ? nodes : [])),
    batchDraw: vi.fn(),
    findOne: vi.fn((selector: string) => nodes.find((node) => `#${node.id()}` === selector) ?? null),
  } as any

  return {
    stage,
    annotationsLayer,
    zonesLayer,
    engine: {
      stage,
      layers: new Map([
        ['zones', zonesLayer],
        ['annotations', annotationsLayer],
      ]),
      history: { execute: vi.fn(), record: vi.fn() },
      createPlantPlacementNode: vi.fn(),
      removeNode: vi.fn(),
      getSelectedNodes: vi.fn(() => nodes),
      invalidateRender: vi.fn(),
    },
  }
}

describe('SelectTool', () => {
  beforeEach(() => {
    selectedObjectIds.value = new Set()
    lockedObjectIds.value = new Set()
  })

  it('moves the full selected set during drag, not only the grabbed node', () => {
    const tool = new SelectTool()
    const dragListeners = new Map<string, (event: any) => void>()
    const a = makeNode('a', 10, 20)
    const b = makeNode('b', 40, 60)
    const { engine, stage } = makeEngine([a.node, b.node])
    stage.on = vi.fn((event: string, handler: (payload: any) => void) => {
        dragListeners.set(event, handler)
      })

    selectedObjectIds.value = new Set(['a', 'b'])
    tool.activate(engine as any)

    dragListeners.get('dragstart')?.({ target: a.node })
    a.node.position({ x: 25, y: 35 })
    dragListeners.get('dragmove')?.({ target: a.node })

    expect(a.node.x()).toBe(25)
    expect(a.node.y()).toBe(35)
    expect(b.node.x()).toBe(55)
    expect(b.node.y()).toBe(75)
    expect(a.layer.batchDraw).not.toHaveBeenCalled()
    expect(b.layer.batchDraw).toHaveBeenCalledTimes(1)

    dragListeners.get('dragend')?.({ target: a.node })
    expect(engine.history.record).toHaveBeenCalledTimes(1)
  })

  it('treats ctrl-click as additive selection toggle', () => {
    const tool = new SelectTool()
    const a = makeNode('a', 10, 20)
    const b = makeNode('b', 40, 60)
    const { engine } = makeEngine([a.node, b.node])

    selectedObjectIds.value = new Set(['a'])
    tool.onMouseDown({
      target: b.node,
      evt: { button: 0, ctrlKey: true, metaKey: false, shiftKey: false },
    } as any, engine as any)

    expect(selectedObjectIds.value).toEqual(new Set(['a', 'b']))
  })

  it('treats cmd-click as additive selection toggle', () => {
    const tool = new SelectTool()
    const a = makeNode('a', 10, 20)
    const b = makeNode('b', 40, 60)
    const { engine } = makeEngine([a.node, b.node])

    selectedObjectIds.value = new Set(['a'])
    tool.onMouseDown({
      target: b.node,
      evt: { button: 0, ctrlKey: false, metaKey: true, shiftKey: false },
    } as any, engine as any)

    expect(selectedObjectIds.value).toEqual(new Set(['a', 'b']))
  })

  it('keeps the current selection when starting a band with ctrl held', () => {
    const tool = new SelectTool()
    const a = makeNode('a', 10, 20)
    const { engine } = makeEngine([a.node])

    selectedObjectIds.value = new Set(['a'])
    tool.onMouseDown({
      target: engine.stage,
      evt: { button: 0, ctrlKey: true, metaKey: false, shiftKey: false },
    } as any, engine as any)

    expect(selectedObjectIds.value).toEqual(new Set(['a']))
  })
})
