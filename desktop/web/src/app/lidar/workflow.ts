import { ensureLidarPolling, stopLidarPolling } from './library-store'

/**
 * Desktop-lifetime owner of library polling.
 *
 * Installed once for the Desktop application/workspace, not per panel and not
 * per Design. Imports and calculations are library work: they keep running and
 * settling across panel navigation and Design replacement, and an import never
 * attaches itself to a Design — Add to Design is the only attachment step.
 */
let installed = false

export function installLidarWorkflow(): void {
  disposeLidarWorkflow()
  installed = true
  // Reopen/application start refreshes immediately and resumes polling if
  // native work is still settling.
  ensureLidarPolling()
}

export function disposeLidarWorkflow(): void {
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
