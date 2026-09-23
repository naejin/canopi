import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ list: vi.fn(), job: vi.fn(), attach: vi.fn(), identity: {} }))
vi.mock('../ipc/lidar', () => ({ lidarListLibrary: mocks.list, lidarGetImportJob: mocks.job }))
vi.mock('../app/design-edit/lidar', () => ({ upsertLidarEntry: mocks.attach }))
vi.mock('../app/document-session/store', async () => {
  const { signal } = await import('@preact/signals')
  return { currentDesign: signal(null), designSessionStore: { sessionIdentity: signal(mocks.identity) } }
})
import * as store from '../app/lidar/library-store'
import { installLidarWorkflow, disposeLidarWorkflow } from '../app/lidar/workflow'
const library = { layers: [{ id: 'layer' }], analyses: [], engine: { available: true, version: null, detail: null } }
const complete = { job_id: 'job', layer_id: 'layer', state: 'Complete' as const, message: null, progress: null }
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve() }
beforeEach(async () => {
  vi.useFakeTimers(); mocks.list.mockReset().mockResolvedValue(library); mocks.job.mockReset().mockImplementation(async () => ({ ...complete })); mocks.attach.mockReset()
  store.openImportJob.value = null; installLidarWorkflow(); await flush()
})
afterEach(() => { disposeLidarWorkflow(); vi.useRealTimers() })
it('healthy terminal read attaches through actual store and workflow', async () => {
  store.recordImportAttachmentIntent('job', 'layer', mocks.identity)
  await store.trackImportJob('job'); await flush()
  expect(mocks.attach).toHaveBeenCalledTimes(1)
})
it('failed settlement retries automatically after transport recovers', async () => {
  mocks.list.mockRejectedValue(new Error('temporary read outage'))
  store.recordImportAttachmentIntent('job', 'layer', mocks.identity)
  await store.trackImportJob('job'); await flush()
  expect(mocks.attach).not.toHaveBeenCalled()
  expect(store.peekImportAttachmentIntent('job')).not.toBeNull()
  mocks.list.mockResolvedValue(library)
  await vi.advanceTimersByTimeAsync(6000); await flush()
  expect(mocks.attach).toHaveBeenCalledTimes(1)
})
it('repeated Complete observes only one in-flight settlement for the job', async () => {
  const releases: ((value: unknown) => void)[] = []
  mocks.list.mockImplementation(() => new Promise(resolve => releases.push(resolve)))
  store.recordImportAttachmentIntent('job', 'layer', mocks.identity)
  store.openImportJob.value = { ...complete }; await flush()
  store.openImportJob.value = { ...complete }; await flush()
  const count = releases.length
  for (const resolve of releases) resolve(library)
  await flush()
  expect(count).toBe(1)
})
it('disposed workflow ignores late failed settlement', async () => {
  let rejectRead!: (reason: Error) => void
  mocks.list.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject }))
  store.recordImportAttachmentIntent('job', 'layer', mocks.identity)
  store.openImportJob.value = { ...complete }; await flush()
  disposeLidarWorkflow()
  store.lidarStatusMessage.value = 'current status'
  rejectRead(new Error('obsolete read error')); await flush()
  expect(store.lidarStatusMessage.value).toBe('current status')
})

it('reinstalled workflow ignores failure from previous installation', async () => {
  let rejectRead!: (reason: Error) => void
  mocks.list.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject }))
  store.recordImportAttachmentIntent('job', 'layer', mocks.identity)
  store.openImportJob.value = { ...complete }; await flush()
  disposeLidarWorkflow()
  installLidarWorkflow(); await flush()
  store.lidarStatusMessage.value = 'current status'
  rejectRead(new Error('obsolete read error')); await flush()
  expect(store.lidarStatusMessage.value).toBe('current status')
})

it('old installation success cannot consume a replacement intent or attach', async () => {
  const releases: ((value: unknown) => void)[] = []
  mocks.list.mockImplementation(() => new Promise((resolve) => releases.push(resolve)))
  store.recordImportAttachmentIntent('job', 'layer', mocks.identity)
  store.openImportJob.value = { ...complete }; await flush()
  const oldRead = releases.length - 1
  expect(oldRead).toBeGreaterThanOrEqual(0)
  disposeLidarWorkflow()
  installLidarWorkflow(); await flush()
  // Replacement attempt for the same job after reinstall.
  store.clearImportAttachmentIntents()
  store.recordImportAttachmentIntent('job', 'layer', mocks.identity)
  store.openImportJob.value = { ...complete, message: 'replacement' }; await flush()
  const replacementRead = releases.length - 1
  expect(replacementRead).toBeGreaterThan(oldRead)
  // Old success resolves late and must not consume the new intent or attach.
  releases[oldRead]?.(library); await flush()
  expect(mocks.attach).not.toHaveBeenCalled()
  expect(store.peekImportAttachmentIntent('job')).not.toBeNull()
  // The replacement still attaches exactly once.
  releases[replacementRead]?.(library); await flush()
  expect(mocks.attach).toHaveBeenCalledTimes(1)
  expect(mocks.attach).toHaveBeenCalledWith('Source', 'layer')
})

it('old attempt finally cannot release the replacement guard', async () => {
  const releases: ((value: unknown) => void)[] = []
  mocks.list.mockImplementation(() => new Promise((resolve) => releases.push(resolve)))
  store.recordImportAttachmentIntent('job', 'layer', mocks.identity)
  store.openImportJob.value = { ...complete }; await flush()
  expect(releases.length).toBe(1)
  disposeLidarWorkflow()
  installLidarWorkflow(); await flush()
  store.clearImportAttachmentIntents()
  store.recordImportAttachmentIntent('job', 'layer', mocks.identity)
  store.openImportJob.value = { ...complete, message: 'replacement' }; await flush()
  const afterReplacement = releases.length
  // Old attempt finishes while replacement is pending.
  releases[0]?.(library); await flush()
  // Repeat Complete/poll tick must not start a third settlement read.
  store.openImportJob.value = { ...complete, message: 'repeat' }; await flush()
  expect(releases.length).toBe(afterReplacement)
  for (const resolve of releases.slice(1)) resolve(library)
  await flush()
  expect(mocks.attach).toHaveBeenCalledTimes(1)
})
