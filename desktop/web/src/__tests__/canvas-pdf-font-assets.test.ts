// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { loadPdfFonts } from '../app/canvas-pdf/text'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
it.each([404, 200])('rejects missing or corrupt packaged font assets (HTTP %s)', async (status) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status })))
  await expect(loadPdfFonts(['Apple'], 'en', 'https://app.test/fonts/')).rejects.toThrow(status === 404 ? 'font-load' : 'font-integrity')
})
it('aborts a stalled font request and releases its timeout', async () => {
  vi.useFakeTimers()
  let requestSignal: AbortSignal | undefined
  vi.stubGlobal('fetch', (_url: URL, options: RequestInit) => new Promise((_resolve, reject) => {
    requestSignal = options.signal ?? undefined
    requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }))
  const result = loadPdfFonts(['Apple'], 'en', 'https://app.test/fonts/').catch((error: Error) => error.name)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(await result).toBe('AbortError')
  expect(requestSignal?.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
