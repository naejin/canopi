import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestView, type TestView } from '../../../__tests__/support/test-view'
import type { ToolHandleId } from '../interaction-types'
import type { ToolHandle } from '../tools/draft'
import type { ScreenInsets, ViewFrameSource } from '../view/types'
import { createHandleLayer, type HandleLayer } from './handle-layer'

const id = (value: string) => value as ToolHandleId

const VERTEX: ToolHandle = {
  id: id('vertex:zone-1:2'),
  anchor: { x: 10, y: 20 },
  hitRadiusPx: 10,
  glyph: 'vertex',
  label: 'Zone control point 3',
}
const CORNER: ToolHandle = {
  id: id('rect-corner:zone-1:ne'),
  anchor: { x: 40, y: 20 },
  hitRadiusPx: 10,
  glyph: 'corner',
  label: 'Zone control point 2',
}
const ROTATE: ToolHandle = {
  id: id('rotate'),
  anchor: { x: 100, y: 50 },
  offsetPx: { x: 0, y: -28 },
  hitRadiusPx: 14,
  glyph: 'rotate',
  label: 'Rotate selection',
}

let container: HTMLDivElement
let view: TestView
let layer: HandleLayer | null = null

function mount(insets?: ScreenInsets): HandleLayer {
  container = document.createElement('div')
  document.body.appendChild(container)
  view = createTestView({ viewport: { x: 5, y: 7, scale: 2 }, insets })
  layer = createHandleLayer({ container, frames: view.frames })
  return layer
}

function handle(handleId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-canvas-handle="${handleId}"]`)
}

afterEach(() => {
  layer?.dispose()
  layer = null
  view?.dispose()
  container?.remove()
})

describe('the handle layer', () => {
  it('draws each handle at its projected anchor with its id, glyph, label and today\'s hit box', () => {
    mount().setHandles([VERTEX, CORNER], null)

    const vertex = handle('vertex:zone-1:2')!
    expect(vertex.dataset.canvasHandleGlyph).toBe('vertex')
    expect(vertex.getAttribute('role')).toBe('button')
    expect(vertex.getAttribute('aria-label')).toBe('Zone control point 3')
    expect(vertex.dataset.canvasHandleScreenX).toBe('25')
    expect(vertex.dataset.canvasHandleScreenY).toBe('47')
    expect(vertex.style.left).toBe('15px')
    expect(vertex.style.top).toBe('37px')
    expect(vertex.style.width).toBe('20px')
    expect(vertex.style.height).toBe('20px')
    expect(vertex.style.zIndex).toBe('29')
    const mark = vertex.firstElementChild as HTMLElement
    expect(mark.style.width).toBe('8px')
    expect(mark.style.background).toBe('var(--color-primary)')
    expect(handle('rect-corner:zone-1:ne')!.style.left).toBe('75px')
  })

  it('draws the rotate handle as today\'s 28 px button centred on its offset anchor', () => {
    mount().setHandles([ROTATE], null)

    const rotate = handle('rotate')!
    expect(rotate.getAttribute('role')).toBe('button')
    expect(rotate.tabIndex).toBe(-1)
    expect(rotate.getAttribute('aria-label')).toBe('Rotate selection')
    expect(rotate.style.width).toBe('28px')
    expect(rotate.style.zIndex).toBe('27')
    // (100, 50) is (205, 107) on screen; 28 px above is the button's centre.
    expect(rotate.style.left).toBe('191px')
    expect(rotate.style.top).toBe('65px')
    expect(rotate.querySelector('svg')).not.toBeNull()
  })

  it('keeps the rotate handle inside the visible map area, as today', () => {
    mount({ top: 40, right: 0, bottom: 0, left: 60 }).setHandles([{ ...ROTATE, anchor: { x: 0, y: 0 } }], null)

    const rotate = handle('rotate')!
    expect(rotate.style.left).toBe('68px')
    expect(rotate.style.top).toBe('48px')
  })

  it('marks the active handle and shows its readout', () => {
    const handles = mount()
    handles.setHandles([{ ...ROTATE, readout: '+15°' }, VERTEX], id('rotate'))

    const rotate = handle('rotate')!
    const readout = rotate.querySelector<HTMLElement>('[data-canvas-handle-readout]')!
    expect(rotate.dataset.canvasHandleActive).toBe('true')
    expect(rotate.style.cursor).toBe('grabbing')
    expect(readout.textContent).toBe('+15°')
    expect(readout.style.display).toBe('inline-flex')
    expect(handle('vertex:zone-1:2')!.dataset.canvasHandleActive).toBeUndefined()

    handles.setHandles([ROTATE, VERTEX], null)
    expect(rotate.dataset.canvasHandleActive).toBeUndefined()
    expect(rotate.style.cursor).toBe('grab')
    expect(readout.style.display).toBe('none')
  })

  it('keeps a handle\'s element while its id stays and drops the handles that go', () => {
    const handles = mount()
    handles.setHandles([VERTEX, ROTATE], null)
    const vertex = handle('vertex:zone-1:2')!
    const rotate = handle('rotate')!

    handles.setHandles([{ ...VERTEX, anchor: { x: 20, y: 20 }, label: 'Moved' }], null)

    expect(handle('vertex:zone-1:2')).toBe(vertex)
    expect(vertex.style.left).toBe('35px')
    expect(vertex.getAttribute('aria-label')).toBe('Moved')
    expect(rotate.isConnected).toBe(false)
    expect(handle('rotate')).toBeNull()
  })

  it('follows the camera frame', () => {
    mount().setHandles([VERTEX], null)

    view.setViewport({ x: 0, y: 0, scale: 1 })

    const vertex = handle('vertex:zone-1:2')!
    expect(vertex.style.left).toBe('0px')
    expect(vertex.style.top).toBe('10px')
    expect(vertex.dataset.canvasHandleScreenX).toBe('10')
  })

  it('a frame moves handles and creates no element', () => {
    mount().setHandles([VERTEX, ROTATE], null)
    const root = container.querySelector<HTMLElement>('[data-canvas-handle-layer]')!
    const elements = [...root.querySelectorAll('*')]
    const created = vi.spyOn(document, 'createElement')
    const createdNs = vi.spyOn(document, 'createElementNS')
    const added = vi.fn()
    const observer = new MutationObserver((records) => added(records.flatMap((record) => [...record.addedNodes])))
    observer.observe(root, { childList: true, subtree: true })

    view.setViewport({ x: 45, y: -13, scale: 2 })
    view.setViewport({ x: 0, y: 0, scale: 1 })

    expect(handle('vertex:zone-1:2')!.style.left).toBe('0px')
    expect(handle('rotate')!.style.left).toBe('86px')
    expect([...root.querySelectorAll('*')]).toEqual(elements)
    expect(created).not.toHaveBeenCalled()
    expect(createdNs).not.toHaveBeenCalled()
    observer.takeRecords().forEach((record) => expect(record.addedNodes).toHaveLength(0))
    observer.disconnect()
    expect(added).not.toHaveBeenCalled()
  })

  it('keeps today\'s key swallow and click stop on the rotate handle', () => {
    mount().setHandles([ROTATE], null)
    const rotate = handle('rotate')!
    const heard = vi.fn()
    container.addEventListener('keydown', heard)
    container.addEventListener('click', heard)

    const key = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    rotate.dispatchEvent(key)
    rotate.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(key.defaultPrevented).toBe(true)
    expect(heard).not.toHaveBeenCalled()
  })

  it('enlarges a point\'s mark under the pointer', () => {
    mount().setHandles([VERTEX], null)
    const vertex = handle('vertex:zone-1:2')!
    const mark = vertex.firstElementChild as HTMLElement

    vertex.dispatchEvent(new Event('pointerenter'))
    expect(mark.style.transform).toBe('scale(1.35)')
    vertex.dispatchEvent(new Event('pointerleave'))
    expect(mark.style.transform).toBe('')
  })

  it('hides with no handles, and dispose removes it and stops following the camera', () => {
    const handles = mount()
    handles.setHandles([VERTEX], null)
    const root = container.querySelector<HTMLElement>('[data-canvas-handle-layer]')!
    expect(root.style.display).toBe('block')

    handles.setHandles([], null)
    expect(root.style.display).toBe('none')
    expect(root.children).toHaveLength(0)

    handles.setHandles([VERTEX], null)
    const vertex = handle('vertex:zone-1:2')!
    handles.dispose()
    layer = null
    view.setViewport({ x: 0, y: 0, scale: 1 })
    expect(root.isConnected).toBe(false)
    expect(vertex.style.left).toBe('15px')
  })

  it('removes its root when it cannot follow the camera', () => {
    container = document.createElement('div')
    view = createTestView()
    const frames: ViewFrameSource = {
      ...view.frames,
      onViewFrame: () => {
        expect(container.querySelector('[data-canvas-handle-layer]')).not.toBeNull()
        throw new Error('frame subscription failed')
      },
    }

    expect(() => createHandleLayer({ container, frames })).toThrow('frame subscription failed')

    expect(container.children).toHaveLength(0)
  })
})
