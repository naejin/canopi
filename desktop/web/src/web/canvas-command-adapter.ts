import {
  dispatchCanvasCommandIntent,
  isCanvasCommandDisabled,
  type CanvasCommandIntent,
  type CanvasCommandIntentAdapter,
  type CanvasCommandProjectionState,
} from '../app/canvas-commands'
import {
  gridVisible,
  rulersVisible,
  snapToGridEnabled,
} from '../app/canvas-settings/signals'
import {
  currentCanvasCommandSurface,
  currentCanvasTool,
  setCurrentCanvasTool,
} from '../canvas/session'

export function readWebCanvasCommandProjectionState(): CanvasCommandProjectionState {
  const surface = currentCanvasCommandSurface.value
  return {
    activeTool: currentCanvasTool.value,
    toolSelectionAvailable: surface !== null,
    canUndo: surface?.history.canUndo.value ?? false,
    canRedo: surface?.history.canRedo.value ?? false,
    settingsAvailable: surface !== null,
    gridVisible: gridVisible.value,
    snapToGridEnabled: snapToGridEnabled.value,
    rulersVisible: rulersVisible.value,
  }
}

export const webCanvasCommandIntentAdapter: CanvasCommandIntentAdapter = {
  selectTool: (tool) => {
    if (!currentCanvasCommandSurface.value) return
    setCurrentCanvasTool(tool)
  },
  undo: () => {
    const surface = currentCanvasCommandSurface.value
    if (!surface?.history.canUndo.value) return
    surface.history.undo()
  },
  redo: () => {
    const surface = currentCanvasCommandSurface.value
    if (!surface?.history.canRedo.value) return
    surface.history.redo()
  },
  toggleGrid: () => currentCanvasCommandSurface.value?.chrome.toggleGrid(),
  toggleSnapToGrid: () => currentCanvasCommandSurface.value?.chrome.toggleSnapToGrid(),
  toggleRulers: () => currentCanvasCommandSurface.value?.chrome.toggleRulers(),
}

export function dispatchCurrentWebCanvasCommandIntent(intent: CanvasCommandIntent): boolean {
  if (isCanvasCommandDisabled(intent, readWebCanvasCommandProjectionState())) return false
  dispatchCanvasCommandIntent(intent, webCanvasCommandIntentAdapter)
  return true
}
