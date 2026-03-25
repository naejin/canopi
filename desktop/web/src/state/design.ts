import { signal, computed, batch } from '@preact/signals'
import type { CanopiFile } from '../types/design'
import { canvasEngine } from '../canvas/engine'
import { toCanopi, fromCanopi, extractExtra } from '../canvas/serializer'
import * as designIpc from '../ipc/design'

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export const designPath = signal<string | null>(null)
export const designName = signal<string>('Untitled')
export const currentDesign = signal<CanopiFile | null>(null)

// Path queued for loading the next time CanvasPanel mounts its engine.
// Set this before navigating to 'canvas' — CanvasPanel consumes and clears it.
export const pendingDesignPath = signal<string | null>(null)

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

// ---------------------------------------------------------------------------
// File actions — all async, all update signals on success
// ---------------------------------------------------------------------------

/** Save to the current path (Ctrl+S). Opens Save As dialog if no path yet. */
export async function saveCurrentDesign(): Promise<void> {
  const engine = canvasEngine
  if (!engine) return

  const content = toCanopi(engine, { name: designName.value }, currentDesign.value)

  if (designPath.value) {
    await designIpc.saveDesign(designPath.value, content)
  } else {
    const path = await designIpc.saveDesignAs(content)
    designPath.value = path
    designName.value = _nameFromPath(path)
  }

  currentDesign.value = content
  markSaved()
}

/** Save As — always prompts for a new path (Ctrl+Shift+S). */
export async function saveAsCurrentDesign(): Promise<void> {
  const engine = canvasEngine
  if (!engine) return

  const content = toCanopi(engine, { name: designName.value }, currentDesign.value)
  try {
    const path = await designIpc.saveDesignAs(content)
    designPath.value = path
    designName.value = _nameFromPath(path)
    currentDesign.value = content
    markSaved()
  } catch (e) {
    if (_isCancelled(e)) return
    throw e
  }
}

/** Open file dialog and load the chosen design (Ctrl+O). */
export async function openDesign(): Promise<void> {
  const engine = canvasEngine
  if (!engine) return

  try {
    const { file, path } = await designIpc.openDesignDialog()
    file.extra = extractExtra(file as unknown as Record<string, unknown>)
    fromCanopi(file, engine)
    currentDesign.value = file
    designName.value = file.name
    designPath.value = path
    resetDirtyBaselines()
    engine.history.clear()
    engine.showCanvasChrome()
  } catch (e) {
    if (_isCancelled(e)) return
    throw e
  }
}

/** Create a blank design (Ctrl+N). */
export async function newDesignAction(): Promise<void> {
  const engine = canvasEngine
  if (!engine) return

  const file = await designIpc.newDesign()
  file.extra = {}
  fromCanopi(file, engine)
  currentDesign.value = file
  designPath.value = null
  designName.value = 'Untitled'
  resetDirtyBaselines()
  engine.history.clear()
  engine.showCanvasChrome()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _nameFromPath(path: string): string {
  const base = path.split('/').pop() ?? path.split('\\').pop() ?? path
  return base.replace(/\.canopi$/i, '') || 'Untitled'
}

function _isCancelled(e: unknown): boolean {
  return typeof e === 'string'
    ? e.includes('Dialog cancelled') || e.includes('cancelled')
    : e instanceof Error
    ? e.message.includes('cancelled')
    : false
}
