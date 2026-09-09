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
    state: signal({ point: { x: 0, y: 0 }, held: false, zoomPercent: 700, previewAvailable: true,
      plants: [{ id: 'mint', name: 'Menthe verte', position: { x: 0, y: 0 }, distanceM: 0 }] }),
    inspect: vi.fn(), setHeld: vi.fn(), highlightPlant: vi.fn(), focusPlant: vi.fn(), dispose: vi.fn(),
  }
  const attachInspectionTo = vi.fn(() => view)
  setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ documents: createTestCanvasDocumentSurface({ attachInspectionTo }) }))
  await act(async () => render(<InspectionLens canvasRef={{ current: document.createElement('div') }} />, root))
  const launcher = root.querySelector<HTMLButtonElement>('button[aria-expanded]')
  expect(launcher).not.toBeNull()
  await act(async () => launcher!.click())
  expect(root.textContent).toContain('Menthe verte')
  expect(attachInspectionTo).toHaveBeenCalledTimes(1)
  const name = root.querySelector<HTMLButtonElement>('button[data-plant-id="mint"]')!
  await act(async () => name.click())
  expect(view.focusPlant).toHaveBeenCalledWith('mint')
  await act(async () => { name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(view.dispose).toHaveBeenCalledTimes(1)
  expect(root.querySelector('button[aria-expanded="false"]')).not.toBeNull()
  expect(document.activeElement).toBe(launcher)
})
