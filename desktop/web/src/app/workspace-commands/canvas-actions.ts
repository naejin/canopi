import { computed } from '@preact/signals'
import {
  createCanvasCommandProjection,
  isCanvasCommandDisabled,
  type CanvasCommandFrom,
  type CanvasCommandIntent,
  type CanvasCommandProjectionState,
  type CanvasEditAction,
  type CanvasViewAction,
} from '../canvas-commands'
import { gridVisible, snapToGridEnabled } from '../canvas-settings/signals'
import { requestPlaceSearchFocus } from '../geocoding/place-search-ui'
import { cyclePlantLabels } from '../plant-display/actions'
import {
  currentCanvasCommandSurface,
  currentCanvasHasSelection,
  currentCanvasKeyboardPort,
  currentCanvasQuerySurface,
  currentCanvasSelection,
  currentCanvasTool,
} from '../../canvas/session'
import type { CanvasCommandSurface } from '../../canvas/runtime/runtime'
import { selectionCommandAvailability } from '../../canvas/runtime/interaction/contextual-selection-actions'
import { openRotateSelectionDialog } from '../rotate-selection/state'
import { sceneHasLockedDesignObjects } from '../../canvas/runtime/scene'
import { t } from '../../i18n'
import { singleKeyShortcuts } from '../settings/state'
import { armCanvasTool } from '../keyboard/arming'

/**
 * The canvas half of the command graph, shared by both editions: projection
 * state read from the live canvas session, and runCanvasIntent, which runs
 * each command on the command surface current at dispatch time.
 */
export function readWorkspaceCanvasProjectionState(): CanvasCommandProjectionState {
  const surface = currentCanvasCommandSurface.value
  const queries = currentCanvasQuerySurface.value
  void currentCanvasSelection.value
  const hasSelection = currentCanvasHasSelection.value
  // Locks change with scene edits; the snapshot below is read on each one.
  void queries?.revision.scene.value
  // The hold changes only with tool calls, settling commits and teardown, and each moves the transient history (S3b).
  void queries?.revision.transientHistory.value
  const selection = hasSelection ? queries?.getDesignObjectSelection() ?? null : null
  return {
    activeTool: currentCanvasTool.value,
    canvasAvailable: surface !== null,
    spatialEditingAvailable: queries?.view.mode.value !== 'overview',
    selection: selection === null ? null : selectionCommandAvailability(selection),
    // The guard's own predicate, so the greyed state and the run-time guard agree, a live press included (U39).
    held: currentCanvasKeyboardPort()?.holdsSelectionDeletes() ?? false,
    lockedObjectsPresent: queries !== null && sceneHasLockedDesignObjects(queries.getSceneSnapshot()),
    canUndo: surface?.history.canUndo.value ?? false,
    canRedo: surface?.history.canRedo.value ?? false,
    gridVisible: gridVisible.value,
    snapToGridEnabled: snapToGridEnabled.value,
  }
}

function withCanvas(run: (canvas: CanvasCommandSurface) => void): void {
  const canvas = currentCanvasCommandSurface.peek()
  if (canvas) run(canvas)
}

function runCanvasEditAction(action: CanvasEditAction): void {
  // The table the menu bar greys with, read live: a hold that began after the menu drew (a press) still refuses Cut and
  // Delete, as the keys and the canvas menu do (U39).
  if (isCanvasCommandDisabled({ type: 'edit', action }, readWorkspaceCanvasProjectionState())) return
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
      case 'deselect': sceneEdits.clearSelection(); return
      case 'group': sceneEdits.groupSelected(); return
      case 'ungroup': sceneEdits.ungroupSelected(); return
      case 'bring-to-front': sceneEdits.bringToFront(); return
      case 'send-to-back': sceneEdits.sendToBack(); return
      case 'rotate':
        // Rotate… asks for the angle; the dialog turns whatever canvas is current then.
        openRotateSelectionDialog({
          rotate: (degrees) => currentCanvasCommandSurface.peek()?.sceneEdits.rotateSelected(degrees),
        })
        return
      case 'lock': sceneEdits.lockSelected(); return
      case 'unlock': sceneEdits.unlockSelected(); return
      case 'unlock-all': sceneEdits.unlockAll(); return
      case 'save-as-stamp': sceneEdits.saveSelectionAsObjectStamp()
    }
  })
}

function runCanvasViewAction(action: CanvasViewAction): void {
  if (action === 'search-place') {
    if (currentCanvasCommandSurface.peek()) requestPlaceSearchFocus()
    return
  }
  if (action === 'cycle-labels') {
    if (currentCanvasCommandSurface.peek()) cyclePlantLabels()
    return
  }
  withCanvas(({ viewport }) => {
    switch (action) {
      case 'zoom-in': viewport.zoomIn(); return
      case 'zoom-out': viewport.zoomOut(); return
      case 'fit-to-design': viewport.zoomToFit(); return
      case 'zoom-to-selection': viewport.zoomToSelection(); return
      case 'reset-north': viewport.resetNorth(); return
      case 'turn-view-left': viewport.rotateBy(-1); return
      case 'turn-view-right': viewport.rotateBy(1)
    }
  })
}

/**
 * Runs one intent on the surface current at dispatch time: the projection's actions, the palette and both editions'
 * key sinks all come here. Each surface arms a tool with its own `from` (the rail, a menu, the palette, a key).
 */
export function runCanvasIntent(intent: CanvasCommandIntent, from: CanvasCommandFrom): void {
  switch (intent.type) {
    case 'select-tool':
      armCanvasTool(intent.tool, { from })
      return
    case 'undo':
      withCanvas((canvas) => { if (canvas.history.canUndo.peek()) canvas.history.undo() })
      return
    case 'redo':
      withCanvas((canvas) => { if (canvas.history.canRedo.peek()) canvas.history.redo() })
      return
    case 'toggle-grid':
      withCanvas((canvas) => canvas.chrome.toggleGrid())
      return
    case 'toggle-snap-to-grid':
      withCanvas((canvas) => canvas.chrome.toggleSnapToGrid())
      return
    case 'edit':
      runCanvasEditAction(intent.action)
      return
    case 'view':
      runCanvasViewAction(intent.action)
  }
}

/** Dispatch one intent unless the live state disables it; true when it ran. */
export function dispatchWorkspaceCanvasIntent(intent: CanvasCommandIntent, from: CanvasCommandFrom): boolean {
  if (isCanvasCommandDisabled(intent, readWorkspaceCanvasProjectionState())) return false
  runCanvasIntent(intent, from)
  return true
}

/** The canvas command projection both editions render: tool rail, view chip, zoom group, menus. */
export const workspaceCanvasCommandProjection = computed(() => createCanvasCommandProjection({
  state: readWorkspaceCanvasProjectionState(),
  run: runCanvasIntent,
  translate: t,
  characterKeys: singleKeyShortcuts.value,
}))
