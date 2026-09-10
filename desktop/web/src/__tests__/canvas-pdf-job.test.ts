import { afterEach, expect, it, vi } from 'vitest'
const workers = vi.hoisted(() => {
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null
    onerror: (() => void) | null = null
    terminate = vi.fn()
    postMessage = vi.fn()
  }
  return { FakeWorker, instances: [] as FakeWorker[] }
})
vi.mock('../app/canvas-pdf/worker?worker&inline', () => ({ default: class extends workers.FakeWorker {
  constructor() { super(); workers.instances.push(this) }
} }))
import { preparePdfJob } from '../app/canvas-pdf/job'
import type { PdfPreparation } from '../app/canvas-pdf/prepare'
const input: PdfPreparation = { input: { name: 'Garden', locale: 'en', commonNames: {}, canvas: { plants: [], zones: [], annotations: [], measurements: [], layers: [] } },
  setup: { paper: 'A4', layers: [] }, fontBaseUrl: 'https://app.test/fonts/',
  labels: { notes: 'Notes', observations: 'Field observations', keyAndNotes: 'Key and notes', overview: 'Overview', plants: 'Plants', actualSize: 'Actual size' } }
afterEach(() => { workers.instances.length = 0; vi.useRealTimers() })
it.each(['success', 'font failure', 'worker failure', 'cancel', 'timeout'] as const)('releases its worker, deadline and abort listener after %s', async (outcome) => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  const promise = preparePdfJob(input, controller.signal)
  const worker = workers.instances[0]!
  const result = { bytes: null, plan: { pages: [], outlines: {}, blocked: 'empty' as const } }
  const settled = promise.then((value) => ({ value }), (error: Error) => ({ error: error.name === 'AbortError' ? 'Aborted' : error.message }))
  if (outcome === 'success') worker.onmessage!({ data: { result } })
  if (outcome === 'font failure') worker.onmessage!({ data: { error: 'prepare-failed' } })
  if (outcome === 'worker failure') worker.onerror!()
  if (outcome === 'cancel') controller.abort()
  if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(120_000)
  expect(await settled).toEqual(outcome === 'success' ? { value: result } : { error: outcome === 'cancel' ? 'Aborted' : outcome === 'timeout' ? 'prepare-timeout' : 'prepare-failed' })
  expect(worker.terminate).toHaveBeenCalledOnce()
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  expect(vi.getTimerCount()).toBe(0)
})
it('does not allocate a worker for an already cancelled operation', async () => {
  await expect(preparePdfJob(input, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
  expect(workers.instances).toEqual([])
})

it('admits progress without resolving bytes and ignores messages after cancellation', async () => {
  const abort = new AbortController(), progress = vi.fn()
  const promise = preparePdfJob(input, abort.signal, progress)
  const settled = promise.catch(error => error.name)
  const worker = workers.instances[0]!, plan = { pages: [], outlines: {}, blocked: null }
  worker.onmessage!({ data: { progress: plan } })
  expect(progress).toHaveBeenCalledWith(plan)
  expect(worker.terminate).not.toHaveBeenCalled()
  abort.abort()
  worker.onmessage!({ data: { progress: plan } })
  expect(progress).toHaveBeenCalledOnce()
  expect(await settled).toBe('AbortError')
})
