// The Desktop key router as platform/desktop.ts installs it, for the suites that press Desktop shortcuts.
import { installKeyRouter, type KeyRouterHandle } from '../../app/keyboard/key-router'
import { singleKeyShortcuts } from '../../app/settings/state'
import { focusOwner } from '../../app/keyboard/focus-owner'
import { currentCanvasKeyboardPort } from '../../canvas/session'
import type { InputPlatform } from '../../canvas/runtime/input/platform'
import { installDesktopKeyRouter } from '../../commands/registry'
import { TEST_KEY_PLATFORM } from './key-router'

export function installDesktopKeys(platform: InputPlatform = TEST_KEY_PLATFORM): KeyRouterHandle {
  return installDesktopKeyRouter(installKeyRouter, {
    target: window,
    canvas: currentCanvasKeyboardPort,
    singleKeys: singleKeyShortcuts,
    focus: focusOwner,
    platform,
    document,
  })
}
