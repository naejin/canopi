import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => {}) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))
import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { createPdfDelivery } from '../app/canvas-pdf/platform.desktop'
beforeEach(() => { vi.clearAllMocks() })
it('writes the prepared bytes after a PDF destination is chosen', async () => {
  vi.mocked(save).mockResolvedValue('/chosen/garden.pdf')
  const result = await createPdfDelivery().save(new Uint8Array([1, 2, 3]), 'Garden', new AbortController().signal)
  expect(result).toBe('saved')
  expect(invoke).toHaveBeenCalledWith('save_canvas_pdf', { data: [1, 2, 3], path: '/chosen/garden.pdf' })
})
it('does not write when the dialog is cancelled or the captured session becomes stale', async () => {
  const delivery = createPdfDelivery(), abort = new AbortController()
  vi.mocked(save).mockResolvedValue(null)
  expect(await delivery.save(new Uint8Array([1]), 'Garden', abort.signal)).toBe('cancelled')
  vi.mocked(save).mockImplementation(async () => { abort.abort(); return '/chosen/stale.pdf' })
  expect(await delivery.save(new Uint8Array([1]), 'Garden', abort.signal)).toBe('cancelled')
  expect(invoke).not.toHaveBeenCalled()
})
