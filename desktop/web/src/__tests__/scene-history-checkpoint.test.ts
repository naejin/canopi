import { effect } from '@preact/signals'
import { describe, expect, it } from 'vitest'

import type { SceneCommand } from '../canvas/runtime/scene-commands'
import { SceneHistory } from '../canvas/runtime/scene-history'

function command(type: string): SceneCommand {
  return { type } as SceneCommand
}

describe('Scene history persistence checkpoints', () => {
  it('acknowledges the exact captured state and becomes clean again only on undo to it', () => {
    const history = new SceneHistory()
    history.record(command('first'), () => {})
    const checkpoint = history.captureCheckpoint()
    history.record(command('second'), () => {})

    expect(history.acknowledgeSaved(checkpoint)).toBe('applied')
    expect(history.isClean).toBe(false)

    history.undo(() => {})
    expect(history.isClean).toBe(true)

    history.redo(() => {})
    expect(history.isClean).toBe(false)

    history.undo(() => {})
    expect(history.isClean).toBe(true)
  })

  it('does not alias an equal-depth branch to the saved state', () => {
    const history = new SceneHistory()
    history.record(command('saved-branch'), () => {})
    const checkpoint = history.captureCheckpoint()
    expect(history.acknowledgeSaved(checkpoint)).toBe('applied')

    history.undo(() => {})
    history.record(command('divergent-branch'), () => {})

    expect(history.isClean).toBe(false)
  })

  it('treats a checkpoint from before clear as stale', () => {
    const history = new SceneHistory()
    const checkpoint = history.captureCheckpoint()

    history.clear()

    expect(history.acknowledgeSaved(checkpoint)).toBe('stale')
    expect(history.isClean).toBe(true)
  })

  it('rejects a checkpoint owned by another history', () => {
    const first = new SceneHistory()
    const second = new SceneHistory()

    expect(() => second.acknowledgeSaved(first.captureCheckpoint())).toThrow(
      'foreign Scene history checkpoint',
    )
  })

  it('preserves a reachable saved identity across history truncation', () => {
    const history = new SceneHistory()
    history.record(command('saved'), () => {})
    expect(history.acknowledgeSaved(history.captureCheckpoint())).toBe('applied')

    for (let index = 0; index < 500; index += 1) {
      history.record(command(`later-${index}`), () => {})
    }
    expect(history.isClean).toBe(false)

    for (let index = 0; index < 500; index += 1) {
      expect(history.undo(() => {})).not.toBeNull()
    }
    expect(history.isClean).toBe(true)
  })

  it('a canUndo observer that throws still lets the clean state be reported', () => {
    const reports: boolean[] = []
    const history = new SceneHistory({ reportCleanState: (clean) => reports.push(clean) })
    const dispose = effect(() => {
      if (history.canUndo.value) throw new Error('observer failed')
    })
    try {
      expect(() => history.record(command('first'), () => {})).toThrow('observer failed')
      expect(reports).toEqual([false])
    } finally {
      dispose()
    }
  })
})
