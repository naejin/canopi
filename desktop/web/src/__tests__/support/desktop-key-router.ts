// The Desktop key router as platform/desktop.ts installs it, for the suites that press Desktop shortcuts.
import { installKeyRouter, type KeyRouterHandle } from '../../app/keyboard/key-router'
import { singleKeyShortcuts } from '../../app/settings/state'
import { cycleFocusRegion } from '../../app/shell/focus-regions'
import { currentCanvasKeyboardPort } from '../../canvas/session'
import { installDesktopKeyRouter } from '../../commands/registry'

export function installDesktopKeys(): KeyRouterHandle {
  return installDesktopKeyRouter(installKeyRouter, {
    target: window,
    canvas: currentCanvasKeyboardPort,
    singleKeys: singleKeyShortcuts,
    focus: { cycleRegion: cycleFocusRegion },
  })
}
