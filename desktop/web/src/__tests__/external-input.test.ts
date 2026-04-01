import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Konva from 'konva'
import { CanvasExternalInput } from '../canvas/runtime/external-input'

describe('CanvasExternalInput drag-and-drop', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    Object.defineProperty(container, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 10,
        top: 20,
        right: 410,
        bottom: 320,
        width: 400,
        height: 300,
      }),
    })
  })

  afterEach(() => {
    container.remove()
  })

  it('creates plant placements through the narrowed engine surface on drop', () => {
    const execute = vi.fn()
    const createPlantPlacementNode = vi.fn(() => new Konva.Group({ id: 'plant-1' }))
    const plantsLayer = {
      add: vi.fn(),
      batchDraw: vi.fn(),
    } as any
    const stage = {
      on: vi.fn(),
      off: vi.fn(),
      container: () => container,
      scaleX: () => 2,
      x: () => 4,
      y: () => 6,
      draggable: vi.fn(() => false),
      fire: vi.fn(),
      getRelativePointerPosition: vi.fn(),
    } as any

    const externalInput = new CanvasExternalInput({
      stage,
      layers: new Map([['plants', plantsLayer]]),
      toolRegistry: new Map(),
      engine: {
        stage,
        layers: new Map([['plants', plantsLayer]]),
        history: { execute, record: vi.fn() },
        createPlantPlacementNode,
        removeNode: vi.fn(),
        getSelectedNodes: vi.fn(() => []),
        invalidateRender: vi.fn(),
      },
      getSpaceHeld: () => false,
      setSpaceHeld: vi.fn(),
      getWasSpaceDraggable: () => false,
      setWasSpaceDraggable: vi.fn(),
      getActiveToolCursor: () => 'default',
      invalidateRender: vi.fn(),
    })

    externalInput.init()

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dropEvent, {
      clientX: { configurable: true, value: 110 },
      clientY: { configurable: true, value: 120 },
      dataTransfer: {
        configurable: true,
        value: {
          getData: () => JSON.stringify({
            canonical_name: 'Malus domestica',
            common_name: 'Apple',
            stratum: 'high',
            width_max_m: 4,
          }),
        },
      },
    })

    container.dispatchEvent(dropEvent)

    expect(createPlantPlacementNode).toHaveBeenCalledWith({
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      stratum: 'high',
      canopySpreadM: 4,
      position: { x: 48, y: 47 },
    })
    expect(execute).toHaveBeenCalledTimes(1)
    expect((execute.mock.calls[0]?.[0] as { type: string }).type).toBe('add-node')

    externalInput.destroy()
  })
})
