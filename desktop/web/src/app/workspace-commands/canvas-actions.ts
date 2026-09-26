import { computed } from '@preact/signals'
import {
  createCanvasCommandProjection,
  dispatchCanvasCommandIntent,
  isCanvasCommandDisabled,
  type CanvasCommandIntent,
  type CanvasCommandIntentAdapter,
  type CanvasCommandProjectionState,
  type CanvasEditAction,
  type CanvasToolId,
  type CanvasViewAction,
} from '../canvas-commands'
import {
  gridVisible,
  rulersVisible,
  snapToGridEnabled,
} from '../canvas-settings/signals'
import { requestPlaceSearchFocus } from '../geocoding/place-search-ui'
import { activePanel, selectPanel } from '../shell/state'
import { readPlantStampSource } from '../../canvas/plant-stamp-source'
import {
  currentCanvasCommandSurface,
  currentCanvasHasSelection,
  currentCanvasQuerySurface,
  currentCanvasSelection,
  currentCanvasTool,
  setCurrentCanvasTool,
} from '../../canvas/session'
import type { CanvasCommandSurface } from '../../canvas/runtime/runtime'
import { t } from '../../i18n'

/**
 * The canvas half of the command graph, shared by both editions: projection
 * state read from the live canvas session, and the intent adapter that runs
 * each command on the command surface current at dispatch time.
 */
export function readWorkspaceCanvasProjectionState(): CanvasCommandProjectionState {
  const surface = currentCanvasCommandSurface.value
  const queries = currentCanvasQuerySurface.value
  void currentCanvasSelection.value
  const canvasAvailable = surface !== null
  return {
    activeTool: currentCanvasTool.value,
    canvasAvailable,
    // Choosing a tool before the canvas mounts primes the tool it starts with.
    toolSelectionAvailable: true,
    spatialEditingAvailable: queries?.viewport.value.mode !== 'overview',
    hasSelection: currentCanvasHasSelection.value,
    sameSpeciesSelectionAvailable: currentCanvasHasSelection.value
      && (queries?.getDesignObjectSelection().sameSpeciesReferenceCanonicalName ?? null) !== null,
    canUndo: surface?.history.canUndo.value ?? false,
    canRedo: surface?.history.canRedo.value ?? false,
    settingsAvailable: canvasAvailable,
    gridVisible: gridVisible.value,
    snapToGridEnabled: snapToGridEnabled.value,
    rulersVisible: rulersVisible.value,
  }
}

function withCanvas(run: (canvas: CanvasCommandSurface) => void): void {
  const canvas = currentCanvasCommandSurface.peek()
  if (canvas) run(canvas)
}

/**
 * Place plants needs a species: without one chosen in the catalog, the
 * command opens the Plant catalog instead of arming a tool that cannot place.
 */
export function selectCanvasTool(tool: CanvasToolId): void {
  if (tool === 'plant-stamp' && !readPlantStampSource()) {
    selectPanel('plant-db')
    return
  }
  if (activePanel.peek() !== 'canvas') selectPanel('canvas')
  setCurrentCanvasTool(tool)
}

export function runCanvasEditAction(action: CanvasEditAction): void {
  withCanvas(({ sceneEdits }) => {
    switch (action) {
      case 'cut':
        sceneEdits.copy()
        sceneEdits.deleteSelected()
        return
      case 'copy': sceneEdits.copy(); return
      case 'paste': sceneEdits.paste(); return
      case 'duplicate': sceneEdits.duplicateSelected(); return
      case 'delete': sceneEdits.deleteSelected(); return
      case 'select-all': sceneEdits.selectAll(); return
      case 'select-same-species': sceneEdits.selectSameSpecies(); return
      case 'group': sceneEdits.groupSelected(); return
      case 'ungroup': sceneEdits.ungroupSelected(); return
      case 'bring-to-front': sceneEdits.bringToFront(); return
      case 'send-to-back': sceneEdits.sendToBack(); return
      case 'lock': sceneEdits.lockSelected(); return
      case 'unlock': sceneEdits.unlockSelected(); return
      case 'save-as-stamp': sceneEdits.saveSelectionAsObjectStamp()
    }
  })
}

export function runCanvasViewAction(action: CanvasViewAction): void {
  if (action === 'search-place') {
    if (currentCanvasCommandSurface.peek()) requestPlaceSearchFocus()
    return
  }
  withCanvas(({ viewport }) => {
    if (action === 'zoom-in') viewport.zoomIn()
    else if (action === 'zoom-out') viewport.zoomOut()
    else viewport.zoomToFit()
  })
}

/** Runs each intent on the surface current at dispatch time. */
export const workspaceCanvasIntentAdapter: CanvasCommandIntentAdapter = {
  selectTool: selectCanvasTool,
  undo: () => withCanvas((canvas) => { if (canvas.history.canUndo.peek()) canvas.history.undo() }),
  redo: () => withCanvas((canvas) => { if (canvas.history.canRedo.peek()) canvas.history.redo() }),
  toggleGrid: () => withCanvas((canvas) => canvas.chrome.toggleGrid()),
  toggleSnapToGrid: () => withCanvas((canvas) => canvas.chrome.toggleSnapToGrid()),
  toggleRulers: () => withCanvas((canvas) => canvas.chrome.toggleRulers()),
  edit: runCanvasEditAction,
  view: runCanvasViewAction,
}

/** Dispatch one intent unless the live state disables it; true when it ran. */
export function dispatchWorkspaceCanvasIntent(intent: CanvasCommandIntent): boolean {
  if (isCanvasCommandDisabled(intent, readWorkspaceCanvasProjectionState())) return false
  dispatchCanvasCommandIntent(intent, workspaceCanvasIntentAdapter)
  return true
}

/** The canvas command projection both editions render: tool rail, view chip, zoom group, menus. */
export const workspaceCanvasCommandProjection = computed(() => createCanvasCommandProjection({
  state: readWorkspaceCanvasProjectionState(),
  intents: workspaceCanvasIntentAdapter,
  translate: t,
}))
