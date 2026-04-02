/**
 * Document dirty-state lifecycle tests.
 *
 * These test the two-baseline dirty model without a full renderer/runtime mount.
 * They exercise the exact signal interactions that caused bugs in rounds 1-4:
 * - R1#3: Dirty breaks at 500 ops (bounded depth vs checkpoint)
 * - R2#1: Open/new marks dirty immediately (clear increments revision)
 * - R4#2: Undo to saved state must clear dirty (checkpoint-based model)
 * - Architecture review: Undo clears dirty even when non-canvas edits remain
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { SceneHistory } from '../canvas/runtime/scene-history'
import type { SceneCommand, SceneCommandRuntime } from '../canvas/runtime/scene-commands'
import { canvasClean, canvasDirty, markCanvasDetachedDirty } from '../state/design'
import {
  nonCanvasRevision,
  designDirty,
  resetDirtyBaselines,
  markSaved,
} from '../state/design'

const mockRuntime: SceneCommandRuntime = {
  sceneStore: null as never,
  setSelection() {},
  setLockedIds() {},
}

function noop(): SceneCommand {
  return {
    type: 'test',
    execute() {},
    undo() {},
    diffs: ['plants'],
  }
}

// Each test gets a fresh history. We also need to reset dirty baselines
// AND clear the shared history so canvasClean starts as true.
let history: SceneHistory

beforeEach(() => {
  history = new SceneHistory()
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
    history.record(noop())
    expect(designDirty.value).toBe(true)
  })

  it('history record/undo/redo reconcile canvas cleanliness', () => {
    history.record(noop())
    history.undo(mockRuntime)
    history.redo(mockRuntime)

    expect(canvasClean.value).toBe(false)
  })

  it('history record marks dirty', () => {
    const cmd: SceneCommand = {
      type: 'recorded-test',
      execute() {},
      undo() {},
      diffs: ['annotations'],
    }

    history.record(cmd)

    expect(designDirty.value).toBe(true)
  })

  it('save clears dirty', () => {
    history.record(noop())
    expect(designDirty.value).toBe(true)
    history.markSaved()
    markSaved()
    expect(designDirty.value).toBe(false)
  })

  it('undo back to saved state clears dirty', () => {
    history.markSaved()
    markSaved()
    history.record(noop())
    expect(designDirty.value).toBe(true)
    history.undo(mockRuntime)
    // Stack is back to saved position — canvas is clean
    expect(designDirty.value).toBe(false)
  })

  it('redo after undo makes dirty again', () => {
    history.markSaved()
    markSaved()
    history.record(noop())
    history.undo(mockRuntime)
    expect(designDirty.value).toBe(false)
    history.redo(mockRuntime)
    expect(designDirty.value).toBe(true)
  })

  it('dirty survives beyond 500 operations (the cap bug)', () => {
    history.markSaved()
    markSaved()

    // Execute 501 commands — stack caps at 500, saved position shifts
    for (let i = 0; i < 501; i++) {
      history.record(noop())
    }

    expect(designDirty.value).toBe(true)

    // Save and one more edit — still works
    history.markSaved()
    markSaved()
    expect(designDirty.value).toBe(false)
    history.record(noop())
    expect(designDirty.value).toBe(true)
  })

  it('save at cap boundary then undo-to-saved works', () => {
    // Fill stack to cap
    for (let i = 0; i < 500; i++) {
      history.record(noop())
    }
    history.markSaved()
    markSaved()
    expect(designDirty.value).toBe(false)

    // One more edit, then undo — back to saved
    history.record(noop())
    expect(designDirty.value).toBe(true)
    history.undo(mockRuntime)
    expect(designDirty.value).toBe(false)
  })

  it('detached canvas dirty survives session teardown until the next save baseline', () => {
    markCanvasDetachedDirty(true)

    expect(canvasDirty.value).toBe(true)
    expect(designDirty.value).toBe(true)

    markSaved()

    expect(canvasDirty.value).toBe(false)
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
    history.record(noop())
    history.undo(mockRuntime)

    // Still dirty because non-canvas edit remains unsaved
    expect(designDirty.value).toBe(true)
  })
})

describe('mixed edit sources', () => {
  it('save clears both canvas and non-canvas dirty', () => {
    history.record(noop())
    nonCanvasRevision.value++
    expect(designDirty.value).toBe(true)
    history.markSaved()
    markSaved()
    expect(designDirty.value).toBe(false)
  })

  it('resetDirtyBaselines clears everything', () => {
    history.record(noop())
    nonCanvasRevision.value++
    expect(designDirty.value).toBe(true)
    resetDirtyBaselines()
    history.clear()
    expect(designDirty.value).toBe(false)
  })
})
