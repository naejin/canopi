import { canvasCommandDefinitionForShortcut } from '../app/canvas-commands'
import { saveProblem } from '../app/document-session/save-problem'
import { savedViewDialogOpen } from '../app/saved-views'
import { modalLayerOpen } from '../app/shell/modal-layer'
import { singleKeyShortcuts } from '../app/settings/state'
import { runFindPlantsShortcut } from '../app/plant-finder/focus'
import { runStoryUndoShortcut } from '../app/stories/actions'
import { matchShellCommandShortcut, type ShellCommandState } from '../app/shell-commands'
import { dispatchWorkspaceCanvasIntent } from '../app/workspace-commands/canvas-actions'
import { isEditableTarget } from '../canvas/runtime/input/editable-target'
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
 * Ctrl Z for a Stories Undo toast on screen, shell shortcuts the browser lets a page keep (Ctrl O, Ctrl S, F1, F2,
 * Ctrl ,), then canvas commands. Canvas keys never
 * act inside a text field unless the command says so (Ctrl K), and character
 * keys stay off while Settings › Keyboard turns single-key shortcuts off.
 */
export function installWebCanvasShortcuts(
  target: Window = window,
  shell: WebShellShortcutSource | null = null,
): () => void {
  activeInstallation?.dispose()

  const handler = (event: KeyboardEvent): void => {
    // A key an earlier listener consumed (the active tool, a menu) is no shortcut.
    if (event.defaultPrevented) return
    // Modal dialogs: no shortcut may change the Design under them.
    if (saveProblem.peek() !== null || savedViewDialogOpen.peek() || modalLayerOpen.peek()) return
    // Ctrl F belongs to the open panel's plant finder, even while a field has focus.
    if (runFindPlantsShortcut(event)) return
    // Ctrl Z answers a Stories Undo toast on screen before the map's history.
    if (runStoryUndoShortcut(event)) return
    const shellCommand = shell ? matchShellCommandShortcut(shell.catalog, event) : null
    if (shellCommand?.shortcut && !BROWSER_RESERVED_SHORTCUTS.has(shellCommand.shortcut)) {
      event.preventDefault()
      if (!shellCommand.isExecutionDisabled(shell!.readState())) shellCommand.execute()
      return
    }
    const definition = canvasCommandDefinitionForShortcut(event, { characterKeys: singleKeyShortcuts.peek() })
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
