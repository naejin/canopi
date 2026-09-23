import { effect } from '@preact/signals'
import { upsertLidarEntry } from '../design-edit/lidar'
import { designSessionStore } from '../document-session/store'
import type { LidarImportJob } from '../../generated/contracts'
import {
  ensureLidarPolling,
  openImportJob,
  refreshLidarLibrary,
  stopLidarPolling,
} from './library-store'

/**
 * Higher workflow for LiDAR library settlement and Design attachment.
 *
 * Installed once for the Desktop application/workspace lifetime, not per panel
 * and not per Design. It coordinates the existing library polling owner and the
 * Design Edit seam; leaf actions never import this module.
 */

interface ImportAttachmentIntent {
  readonly jobId: string
  readonly layerId: string
  readonly designIdentity: object
  consumed: boolean
}

const attachmentIntents = new Map<string, ImportAttachmentIntent>()

/**
 * Record that a successful import submission should attach its layer when the
 * job commits, but only in the Design session that submitted it.
 *
 * Captured at submission time so closing Data, navigating panels or replacing
 * the Design cannot invent an attachment the user never made.
 */
export function recordImportAttachmentIntent(
  jobId: string,
  layerId: string,
  designIdentity: object,
): void {
  attachmentIntents.set(jobId, {
    jobId,
    layerId,
    designIdentity,
    consumed: false,
  })
}

/** Drop a pending attachment without presenting anything. */
export function discardImportAttachmentIntent(jobId: string): void {
  attachmentIntents.delete(jobId)
}

function consumeAttachment(job: LidarImportJob): void {
  const intent = attachmentIntents.get(job.job_id)
  if (!intent || intent.consumed) return
  intent.consumed = true
  attachmentIntents.delete(job.job_id)
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
 * A committed success refreshes the library first so the presentation attaches
 * against the head the job published, then attaches once if the submitting
 * Design session is still active. Failure and cancellation consume the intent
 * without attaching. A cancellation *request* never decides attachment: the
 * observed terminal result does, so a job that already committed still attaches.
 */
function settleImportAttachment(job: LidarImportJob): void {
  if (!isTerminal(job.state)) return
  if (job.state === 'Complete') {
    void refreshLidarLibrary()
      .catch(() => {
        // A passive refresh failure still allows attachment: the entity exists.
      })
      .then(() => consumeAttachment(job))
    return
  }
  consumeAttachment(job)
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
  attachmentIntents.clear()
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
