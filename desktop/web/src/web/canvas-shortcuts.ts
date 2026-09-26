import { canvasCommandDefinitionForShortcut } from '../app/canvas-commands'
import { saveProblem } from '../app/document-session/save-problem'
import { runFindPlantsShortcut } from '../app/plant-finder/focus'
import { matchShellCommandShortcut, type ShellCommandState } from '../app/shell-commands'
import { dispatchWorkspaceCanvasIntent } from '../app/workspace-commands/canvas-actions'
import { isEditableTarget } from '../canvas/runtime/interaction/pointer-utils'
import { BROWSER_RESERVED_SHORTCUTS, type BrowserShellCatalog } from './browser-shell-commands'

interface WebCanvasShortcutInstallation {
  readonly target: Window
  readonly handler: (event: KeyboardEvent) => void
  dispose(): void
}

export interface WebShellShortcutSource {
  readonly catalog: BrowserShellCatalog
  readState(): ShellCommandState
}

let activeInstallation: WebCanvasShortcutInstallation | null = null

/**
 * Web Edition keyboard routing: Ctrl F for the open panel's plant finder,
 * shell shortcuts the browser lets a page keep (Ctrl O, Ctrl S, F1, F2,
 * Ctrl ,), then canvas commands. Canvas keys never
 * act inside a text field unless the command says so (Ctrl K).
 */
export function installWebCanvasShortcuts(
  target: Window = window,
  shell: WebShellShortcutSource | null = null,
): () => void {
  activeInstallation?.dispose()

  const handler = (event: KeyboardEvent): void => {
    // The save dialog is modal: no shortcut may change the Design under it.
    if (saveProblem.peek() !== null) return
    // Ctrl F belongs to the open panel's plant finder, even while a field has focus.
    if (runFindPlantsShortcut(event)) return
    const shellCommand = shell ? matchShellCommandShortcut(shell.catalog, event) : null
    if (shellCommand?.shortcut && !BROWSER_RESERVED_SHORTCUTS.has(shellCommand.shortcut)) {
      event.preventDefault()
      if (!shellCommand.isExecutionDisabled(shell!.readState())) shellCommand.execute()
      return
    }
    const definition = canvasCommandDefinitionForShortcut(event)
    if (!definition) return
    if (isEditableTarget(event.target) && !definition.worksInTextFields) return
    if (!dispatchWorkspaceCanvasIntent(definition.intent)) return
    event.preventDefault()
  }
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    target.removeEventListener('keydown', handler)
    if (activeInstallation === installation) activeInstallation = null
  }
  const installation: WebCanvasShortcutInstallation = { target, handler, dispose }

  target.addEventListener('keydown', handler)
  activeInstallation = installation
  return dispose
}

export function disposeWebCanvasShortcuts(): void {
  activeInstallation?.dispose()
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeWebCanvasShortcuts)
}
