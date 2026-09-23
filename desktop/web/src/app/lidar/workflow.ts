import { effect } from '@preact/signals'
import { upsertLidarEntry } from '../design-edit/lidar'
import { designSessionStore } from '../document-session/store'
import type { LidarImportJob } from '../../generated/contracts'
import {
  clearImportAttachmentIntents,
  consumeImportAttachmentIntent,
  ensureLidarPolling,
  lidarStatusMessage,
  openImportJob,
  peekImportAttachmentIntent,
  libraryPollTick,
  libraryReadSequence,
  refreshLidarLibraryFresh,
  stopLidarPolling,
  type ImportAttachmentIntent,
} from './library-store'

/**
 * Higher workflow for LiDAR library settlement and Design attachment.
 *
 * Installed once for the Desktop application/workspace lifetime, not per panel
 * and not per Design. It coordinates the existing library polling owner and the
 * Design Edit seam; leaf actions never import this module.
 */

export {
  discardImportAttachmentIntent,
  recordImportAttachmentIntent,
} from './library-store'

function consumeAttachment(job: LidarImportJob, intent: ImportAttachmentIntent): void {
  intent.consumed = true
  if (job.state !== 'Complete') return
  // Only the exact Design session that submitted the import may receive it.
  if (designSessionStore.sessionIdentity.value !== intent.designIdentity) return
  // Empty patch: an already-present entry keeps its order, visibility and opacity.
  upsertLidarEntry('Source', intent.layerId)
}

function isTerminal(state: LidarImportJob['state']): boolean {
  return state === 'Complete' || state === 'Cancelled' || state === 'Failed'
}

/**
 * Observe tracked import jobs and settle their attachment intent exactly once.
 *
 * A committed success waits for a library read that *starts after* Complete
 * was observed, then attaches once in the submitting Design session. Failure
 * and cancellation consume the intent without attaching. A cancellation
 * *request* never decides attachment. On a failed fresh read the intent stays
 * pending for the next normal poll/reopen refresh.
 */
function settleImportAttachment(job: LidarImportJob): void {
  if (!isTerminal(job.state)) return
  const intent = peekImportAttachmentIntent(job.job_id)
  if (!intent) return
  if (job.state !== 'Complete') {
    const consumed = consumeImportAttachmentIntent(job.job_id)
    if (consumed) consumeAttachment(job, consumed)
    return
  }
  // One attempt per job at a time. Repeated Complete observations must not
  // start concurrent settlement reads.
  if (settlingJobs.has(job.job_id)) return
  settlingJobs.add(job.job_id)
  const attemptInstalled = () => installed
  // Fence at the terminal observation: the settlement read must start after
  // this point, never join a read already under way.
  const fence = libraryReadSequence()
  void refreshLidarLibraryFresh(fence)
    .then((snapshot) => {
      // A successful post-fence read is the only path to attachment or a
      // missing-target conclusion. A failed read retains the intent.
      if (!attemptInstalled()) return
      const settled = consumeImportAttachmentIntent(job.job_id)
      if (!settled) return
      const library = snapshot
      const present = library?.layers.some((layer) => layer.id === settled.layerId) ?? false
      if (!present) {
        lidarStatusMessage.value = `Imported layer ${settled.layerId} is no longer in the library`
        return
      }
      consumeAttachment(job, settled)
    })
    .catch((error) => {
      // Fresh read failed: retain the pending intent and report the read
      // error. Do not fall through to success or missing-target handling.
      // Teardown fences error callbacks so obsolete completions cannot mutate
      // document or status.
      if (!attemptInstalled()) return
      lidarStatusMessage.value = error instanceof Error ? error.message : String(error)
    })
    .finally(() => {
      // A failed attempt releases the guard for the next normal tick.
      settlingJobs.delete(job.job_id)
    })
}

/** Jobs with a settlement attempt currently in flight. */
const settlingJobs = new Set<string>()

let attachmentDisposer: (() => void) | null = null
let installed = false

/**
 * Install the Desktop-lifetime LiDAR workflow owner.
 *
 * Data/Analysis/Layers subscribe to the library signals and may request an
 * immediate refresh, but they never stop this owner's shared timer.
 */
export function installLidarWorkflow(): void {
  disposeLidarWorkflow()
  installed = true
  attachmentDisposer = effect(() => {
    // Retry pending settlement on each poll tick even when the job state
    // remains Complete; a failed attempt must recover without a reopen.
    void libraryPollTick.value
    const job = openImportJob.value
    if (!job) return
    settleImportAttachment(job)
  })
  // Reopen/application start refreshes immediately and resumes polling if
  // native jobs are still settling.
  ensureLidarPolling()
}

export function disposeLidarWorkflow(): void {
  attachmentDisposer?.()
  attachmentDisposer = null
  clearImportAttachmentIntents()
  settlingJobs.clear()
  if (installed) {
    stopLidarPolling()
    installed = false
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeLidarWorkflow()
  })
}
