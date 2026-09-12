import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import type { CanvasInspectionHandle } from '../canvas/inspection'
import { setCurrentCanvasSession } from '../canvas/session'
import { InspectionLens } from '../components/canvas/InspectionLens'
import { createTestCanvasDocumentSurface, createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'

const root = document.createElement('div')
afterEach(() => { render(null, root); setCurrentCanvasSession(null); root.remove() })

it('opens the optional lens, identifies plants and releases the view on Escape', async () => {
  document.body.appendChild(root)
  const view: CanvasInspectionHandle = {
    state: signal({ point: { x: 0, y: 0 }, scale: 10, zoomPercent: 700, previewAvailable: true, frame: { width: 430, height: 390 },
      plants: [{ id: 'mint', name: 'Menthe verte', position: { x: 0, y: 0 }, distanceM: 0,
        screenPosition: { x: 215, y: 195 }, label: { x: 160, y: 208, width: 110, height: 24, lines: ['Menthe verte'] } }] }),
    centerOnCanvas: vi.fn(), panBy: vi.fn(), zoomBy: vi.fn(), highlightPlant: vi.fn(), focusPlant: vi.fn(), dispose: vi.fn(),
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const attachInspectionTo = vi.fn(() => view)
  setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ documents: createTestCanvasDocumentSurface({ attachInspectionTo }) }))
  await act(async () => render(<InspectionLens canvasRef={{ current: host }} />, root))
  const launcher = root.querySelector<HTMLButtonElement>('button[aria-expanded]')
  expect(launcher).not.toBeNull()
  await act(async () => launcher!.click())
  expect(root.textContent).toContain('Menthe verte')
  expect(root.textContent).not.toContain('Hold view')
  expect(root.textContent).not.toContain('Follow pointer')
  await act(async () => { host.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 100 })) })
  expect(view.panBy).not.toHaveBeenCalled()
  expect(view.centerOnCanvas).not.toHaveBeenCalled()
  expect(host.querySelector('[data-inspection-source] rect')?.getAttribute('width')).toBe('43')
  const frame = root.querySelector<HTMLElement>('[data-inspection-frame]')!
  await act(async () => { frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
  expect(view.panBy).toHaveBeenCalledWith({ x: 2, y: 0 })
  const pointer = (target: EventTarget, type: string, x: number) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 0 })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    target.dispatchEvent(event)
  }
  await act(async () => { pointer(frame, 'pointerdown', 100); pointer(document, 'pointermove', 80) })
  expect(view.panBy).toHaveBeenLastCalledWith({ x: 2, y: 0 })
  const calls = vi.mocked(view.panBy).mock.calls.length
  await act(async () => { window.dispatchEvent(new Event('blur')); pointer(document, 'pointermove', 60) })
  expect(view.panBy).toHaveBeenCalledTimes(calls)
  expect(calls).toBe(2)
  for (const terminal of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    await act(async () => {
      pointer(frame, 'pointerdown', 100)
      pointer(terminal === 'lostpointercapture' ? frame : document, terminal, 100)
      pointer(document, 'pointermove', 60)
    })
    expect(view.panBy).toHaveBeenCalledTimes(calls)
  }
  await act(async () => root.querySelector<HTMLButtonElement>('[aria-label="Centre on canvas view"]')!.click())
  expect(view.centerOnCanvas).toHaveBeenCalledTimes(1)
  expect(attachInspectionTo).toHaveBeenCalledTimes(1)
  const expand = root.querySelector<HTMLButtonElement>('button[aria-label="Expand lens"]')!
  expect(expand).not.toBeNull()
  await act(async () => expand.click())
  expect(root.querySelector('[data-expanded="true"]')).not.toBeNull()
  expect(attachInspectionTo).toHaveBeenCalledTimes(1)
  const name = root.querySelector<HTMLButtonElement>('button[data-plant-id="mint"]')!
  expect(root.querySelector('[data-inspection-frame]')?.contains(name)).toBe(true)
  expect(root.querySelector('ol')).toBeNull()
  expect(name.style.left).toBe('160px')
  expect(root.querySelector('[data-inspection-frame] line')?.getAttribute('x1')).toBe('215')
  await act(async () => name.click())
  expect(view.focusPlant).toHaveBeenCalledWith('mint')
  await act(async () => { pointer(frame, 'pointerdown', 100) })
  await act(async () => { name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  pointer(document, 'pointermove', 50)
  expect(view.panBy).toHaveBeenCalledTimes(calls)
  expect(view.dispose).toHaveBeenCalledTimes(1)
  expect(host.querySelector('[data-inspection-source]')).toBeNull()
  host.remove()
  expect(root.querySelector('button[aria-expanded="false"]')).not.toBeNull()
  expect(document.activeElement).toBe(launcher)
})
