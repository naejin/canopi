import {
  canvasCommandIntentForShortcut,
  type CanvasCommandShortcutInput,
} from '../app/canvas-commands'
import { saveProblem } from '../app/document-session/save-problem'
import { isPlaceSearchShortcut, openPlaceSearch } from '../app/geocoding/place-search-ui'
import { runFindPlantsShortcut } from '../app/plant-finder/focus'
import { getCurrentCanvasSession } from '../canvas/session'
import { isEditableTarget } from '../canvas/runtime/interaction/pointer-utils'
import { dispatchCurrentWebCanvasCommandIntent } from './canvas-command-adapter'

interface WebCanvasShortcutInstallation {
  readonly target: Window
  readonly handler: (event: KeyboardEvent) => void
  dispose(): void
}

let activeInstallation: WebCanvasShortcutInstallation | null = null

export function installWebCanvasShortcuts(target: Window = window): () => void {
  activeInstallation?.dispose()

  const handler = (event: KeyboardEvent): void => {
    // The save dialog is modal: no shortcut may change the Design under it.
    if (saveProblem.peek() !== null) return
    if (runFindPlantsShortcut(event)) return
    if (isEditableTarget(event.target)) return
    if (isPlaceSearchShortcut(event)) {
      if (!getCurrentCanvasSession()) return
      openPlaceSearch()
      event.preventDefault()
      return
    }
    const intent = canvasCommandIntentForShortcut(shortcutInput(event))
    if (!intent || !dispatchCurrentWebCanvasCommandIntent(intent)) return
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

function shortcutInput(event: KeyboardEvent): CanvasCommandShortcutInput {
  return {
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeWebCanvasShortcuts)
}
