import { effect } from '@preact/signals'
import { designSessionStore } from '../document-session/store'
import { settleSlopeAttachments } from './actions'
import { ensureLidarPolling, lidarLibrary, stopLidarPolling } from './library-store'

/**
 * Desktop-lifetime owner of library polling.
 *
 * Installed once for the Desktop application/workspace, not per panel and not
 * per Design. Imports and calculations are library work: they keep running and
 * settling across panel navigation and Design replacement. An import never
 * attaches itself to a Design; a slope asked for from Layers joins only the
 * Design session that asked, once it is ready.
 */
let installed = false
let disposeAttachments: (() => void) | null = null

export function installLidarWorkflow(): void {
  disposeLidarWorkflow()
  installed = true
  // Reads the snapshot and the session identity, so a Design switch settles
  // pending attachments at once.
  disposeAttachments = effect(() => {
    designSessionStore.sessionIdentity.value
    settleSlopeAttachments(lidarLibrary.value)
  })
  // Reopen/application start refreshes immediately and resumes polling if
  // native work is still settling.
  ensureLidarPolling()
}

export function disposeLidarWorkflow(): void {
  if (installed) {
    stopLidarPolling()
    disposeAttachments?.()
    disposeAttachments = null
    installed = false
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeLidarWorkflow()
  })
}
