import { signal, computed, batch } from '@preact/signals'
import type { CanopiFile } from '../types/design'
import { getCurrentCanvasSession } from '../canvas/session'

// Low-level document session store and canonical signal surface.
// Higher-level document policy lives in app/document-session.

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export const designPath = signal<string | null>(null)
export const designName = signal<string>('Untitled')
export const currentDesign = signal<CanopiFile | null>(null)

// Path queued for loading the next time CanvasPanel mounts its engine.
// Set this before navigating to 'canvas' — CanvasPanel consumes and clears it.
export const pendingDesignPath = signal<string | null>(null)
export const pendingTemplateImport = signal<{ path: string; name: string } | null>(null)

// ---------------------------------------------------------------------------
// Two-baseline dirty model
//
// Canvas dirty: tracked by the active canvas runtime history via saved checkpoint position.
//   canvasClean is the authority — true when _past.length
//   matches _savedPosition and the checkpoint hasn't been truncated.
//   Safe against the 500-cap: if truncation shifts past the saved position,
//   canvasClean stays false permanently until the next save.
//   Supports undo-to-clean: undoing back to the saved position = clean.
//
// Non-canvas dirty: revision counter for tab edits (timeline/budget/consortium).
//
// Composite: document is dirty if either side has unsaved changes.
// ---------------------------------------------------------------------------

/** Incremented on each non-canvas edit (tab mutations). */
export const nonCanvasRevision = signal<number>(0)
/** nonCanvasRevision at the time of last save. */
export const nonCanvasSavedRevision = signal<number>(0)

/** Whether the last autosave attempt failed. */
export const autosaveFailed = signal<boolean>(false)

/**
 * Canvas clean signal — written by the active canvas runtime history.
 * True when the canvas matches the last saved state.
 * This is a bridge signal so designDirty can be computed without
 * depending on a concrete canvas runtime instance directly.
 */
export const canvasClean = signal<boolean>(true)
/**
 * Sticky canvas-dirty bridge for when the canvas session is torn down while
 * unsaved canvas edits still exist in the canonical document snapshot.
 */
export const detachedCanvasDirty = signal<boolean>(false)
export const canvasDirty = computed(() =>
  detachedCanvasDirty.value || !canvasClean.value
)

/** Composite dirty — true if either canvas or non-canvas has unsaved changes. */
export const designDirty = computed(() =>
  canvasDirty.value
  || nonCanvasRevision.value !== nonCanvasSavedRevision.value
)

/** Reset all dirty baselines to zero (used on open/new/queued-load). */
export function resetDirtyBaselines(): void {
  batch(() => {
    canvasClean.value = true
    detachedCanvasDirty.value = false
    nonCanvasRevision.value = 0
    nonCanvasSavedRevision.value = 0
    autosaveFailed.value = false
  })
}

/** Mark save baseline as current state (used after successful save). */
export function markSaved(): void {
  // Tell history to remember the current position as saved
  getCurrentCanvasSession()?.markSaved()
  detachedCanvasDirty.value = false
  nonCanvasSavedRevision.value = nonCanvasRevision.value
  autosaveFailed.value = false
}

export function markCanvasDetachedDirty(dirty: boolean): void {
  detachedCanvasDirty.value = dirty
}

/** Apply the canonical document signals after a successful replacement/save. */
export function replaceCurrentDesignState(
  file: CanopiFile,
  path: string | null,
  name: string,
): void {
  batch(() => {
    currentDesign.value = file
    designPath.value = path
    designName.value = name
  })
}
