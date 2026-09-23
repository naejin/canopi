import { effect } from '@preact/signals'
import { upsertLidarEntry } from '../design-edit/lidar'
import { designSessionStore } from '../document-session/store'
import type { LidarImportJob } from '../../generated/contracts'
import {
  clearImportAttachmentIntents,
  consumeImportAttachmentIntent,
  ensureLidarPolling,
  lidarLibrary,
  lidarStatusMessage,
  openImportJob,
  peekImportAttachmentIntent,
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
  void refreshLidarLibraryFresh()
    .catch(() => {
      // Fresh read failed: retain the pending intent for the next poll.
    })
    .then(() => {
      const settled = consumeImportAttachmentIntent(job.job_id)
      if (!settled) return
      // A successful fresh read that no longer lists the layer means the
      // target disappeared; consume without attaching and report it.
      const library = lidarLibrary.value
      const present = library?.layers.some((layer) => layer.id === settled.layerId) ?? false
      if (!present) {
        lidarStatusMessage.value = `Imported layer ${settled.layerId} is no longer in the library`
        return
      }
      consumeAttachment(job, settled)
    })
}

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
