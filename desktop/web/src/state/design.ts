import { signal, computed, batch } from '@preact/signals'
import type { CanopiFile } from '../types/design'
import { canvasEngine } from '../canvas/engine'

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
// Canvas dirty: tracked by CanvasHistory via saved checkpoint position.
//   history.canvasClean signal is the authority — true when _past.length
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
 * Canvas clean signal — written by CanvasHistory._updateCanvasClean().
 * True when the canvas matches the last saved state.
 * This is a bridge signal so designDirty can be computed without
 * depending on the CanvasEngine instance directly.
 */
export const canvasClean = signal<boolean>(true)

/** Composite dirty — true if either canvas or non-canvas has unsaved changes. */
export const designDirty = computed(() =>
  !canvasClean.value
  || nonCanvasRevision.value !== nonCanvasSavedRevision.value
)

/** Reset all dirty baselines to zero (used on open/new/queued-load). */
export function resetDirtyBaselines(): void {
  batch(() => {
    canvasClean.value = true
    nonCanvasRevision.value = 0
    nonCanvasSavedRevision.value = 0
    autosaveFailed.value = false
  })
}

/** Mark save baseline as current state (used after successful save). */
export function markSaved(): void {
  // Tell history to remember the current position as saved
  canvasEngine?.history.markSaved()
  nonCanvasSavedRevision.value = nonCanvasRevision.value
  autosaveFailed.value = false
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
