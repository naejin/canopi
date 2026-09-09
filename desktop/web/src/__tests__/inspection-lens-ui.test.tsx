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
    state: signal({ point: { x: 0, y: 0 }, held: false, zoomPercent: 700, previewAvailable: true, frame: { width: 430, height: 390 },
      plants: [{ id: 'mint', name: 'Menthe verte', position: { x: 0, y: 0 }, distanceM: 0,
        screenPosition: { x: 215, y: 195 }, label: { x: 160, y: 208, width: 110, height: 24, lines: ['Menthe verte'] } }] }),
    inspect: vi.fn(), setHeld: vi.fn(), zoomBy: vi.fn(), highlightPlant: vi.fn(), focusPlant: vi.fn(), dispose: vi.fn(),
  }
  const attachInspectionTo = vi.fn(() => view)
  setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ documents: createTestCanvasDocumentSurface({ attachInspectionTo }) }))
  await act(async () => render(<InspectionLens canvasRef={{ current: document.createElement('div') }} />, root))
  const launcher = root.querySelector<HTMLButtonElement>('button[aria-expanded]')
  expect(launcher).not.toBeNull()
  await act(async () => launcher!.click())
  expect(root.textContent).toContain('Menthe verte')
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
  await act(async () => { name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(view.dispose).toHaveBeenCalledTimes(1)
  expect(root.querySelector('button[aria-expanded="false"]')).not.toBeNull()
  expect(document.activeElement).toBe(launcher)
})
