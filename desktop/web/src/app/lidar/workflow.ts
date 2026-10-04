import { effect } from '@preact/signals'
import { designSessionStore } from '../document-session/store'
import { settleResultAttachments } from './actions'
import { ensureLidarPolling, lidarLibrary, stopLidarPolling } from './library-store'

/**
 * Desktop-lifetime owner of library polling.
 *
 * Installed once for the Desktop application/workspace, not per panel and not
 * per Design. Imports and analyses are library work: they keep running and
 * settling across panel navigation and Design replacement. An import never
 * attaches itself to a Design; results asked for from Layers join only the
 * Design session that asked, once they are published.
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
    settleResultAttachments(lidarLibrary.value)
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
