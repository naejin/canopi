/**
 * Document dirty-state lifecycle tests.
 *
 * These test the two-baseline dirty model without a full Konva/Tauri runtime.
 * They exercise the exact signal interactions that caused bugs in rounds 1-4:
 * - R1#3: Dirty breaks at 500 ops (bounded depth vs checkpoint)
 * - R2#1: Open/new marks dirty immediately (clear increments revision)
 * - R4#2: Undo to saved state must clear dirty (checkpoint-based model)
 * - Architecture review: Undo clears dirty even when non-canvas edits remain
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { CanvasHistory, type Command } from '../canvas/history'
import {
  nonCanvasRevision,
  designDirty,
  resetDirtyBaselines,
  markSaved,
} from '../state/design'

// Minimal mock engine — history methods only need the engine for execute/undo
const mockEngine = {} as any

// Minimal command that does nothing (we only care about dirty tracking)
function noop(): Command {
  return {
    type: 'test',
    execute() {},
    undo() {},
  }
}

// Each test gets a fresh history. We also need to reset dirty baselines
// AND clear the shared history so canvasClean starts as true.
let history: CanvasHistory

beforeEach(() => {
  history = new CanvasHistory()
  resetDirtyBaselines()
  history.clear()
})

describe('dirty state after open/new', () => {
  it('is clean after resetDirtyBaselines + history.clear', () => {
    expect(designDirty.value).toBe(false)
  })

  it('is clean regardless of clear/reset ordering', () => {
    resetDirtyBaselines()
    history.clear()
    expect(designDirty.value).toBe(false)

    history.clear()
    resetDirtyBaselines()
    expect(designDirty.value).toBe(false)
  })
})

describe('canvas edits', () => {
  it('single edit makes dirty', () => {
    history.execute(noop(), mockEngine)
    expect(designDirty.value).toBe(true)
  })

  it('save clears dirty', () => {
    history.execute(noop(), mockEngine)
    expect(designDirty.value).toBe(true)
    history.markSaved()
    markSaved()
    expect(designDirty.value).toBe(false)
  })

  it('undo back to saved state clears dirty', () => {
    history.markSaved()
    markSaved()
    history.execute(noop(), mockEngine)
    expect(designDirty.value).toBe(true)
    history.undo(mockEngine)
    // Stack is back to saved position — canvas is clean
    expect(designDirty.value).toBe(false)
  })

  it('redo after undo makes dirty again', () => {
    history.markSaved()
    markSaved()
    history.execute(noop(), mockEngine)
    history.undo(mockEngine)
    expect(designDirty.value).toBe(false)
    history.redo(mockEngine)
    expect(designDirty.value).toBe(true)
  })

  it('dirty survives beyond 500 operations (the cap bug)', () => {
    history.markSaved()
    markSaved()

    // Execute 501 commands — stack caps at 500, saved position shifts
    for (let i = 0; i < 501; i++) {
      history.execute(noop(), mockEngine)
    }

    expect(designDirty.value).toBe(true)

    // Save and one more edit — still works
    history.markSaved()
    markSaved()
    expect(designDirty.value).toBe(false)
    history.execute(noop(), mockEngine)
    expect(designDirty.value).toBe(true)
  })

  it('save at cap boundary then undo-to-saved works', () => {
    // Fill stack to cap
    for (let i = 0; i < 500; i++) {
      history.execute(noop(), mockEngine)
    }
    history.markSaved()
    markSaved()
    expect(designDirty.value).toBe(false)

    // One more edit, then undo — back to saved
    history.execute(noop(), mockEngine)
    expect(designDirty.value).toBe(true)
    history.undo(mockEngine)
    expect(designDirty.value).toBe(false)
  })
})

describe('non-canvas edits (timeline/budget/consortium)', () => {
  it('non-canvas edit makes dirty', () => {
    nonCanvasRevision.value++
    expect(designDirty.value).toBe(true)
  })

  it('save clears non-canvas dirty', () => {
    nonCanvasRevision.value++
    markSaved()
    expect(designDirty.value).toBe(false)
  })

  it('canvas undo to clean does not clear non-canvas dirty', () => {
    // Non-canvas edit
    nonCanvasRevision.value++

    // Canvas edit + undo (returns to saved canvas state)
    history.execute(noop(), mockEngine)
    history.undo(mockEngine)

    // Still dirty because non-canvas edit remains unsaved
    expect(designDirty.value).toBe(true)
  })
})

describe('mixed edit sources', () => {
  it('save clears both canvas and non-canvas dirty', () => {
    history.execute(noop(), mockEngine)
    nonCanvasRevision.value++
    expect(designDirty.value).toBe(true)
    history.markSaved()
    markSaved()
    expect(designDirty.value).toBe(false)
  })

  it('resetDirtyBaselines clears everything', () => {
    history.execute(noop(), mockEngine)
    nonCanvasRevision.value++
    expect(designDirty.value).toBe(true)
    resetDirtyBaselines()
    history.clear()
    expect(designDirty.value).toBe(false)
  })
})
