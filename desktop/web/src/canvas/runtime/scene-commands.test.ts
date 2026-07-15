import { describe, expect, it } from 'vitest'

import { createScenePatchCommand } from './scene-commands'
import { createDefaultScenePersistedState } from './scene'

describe('Scene commands', () => {
  it('preserves first-seen typed selection order in history patches', () => {
    const persisted = createDefaultScenePersistedState()

    const command = createScenePatchCommand(
      'select-unicode-targets',
      { persisted, selectedTargets: [] },
      {
        persisted,
        selectedTargets: [
          { kind: 'zone', id: 'é' },
          { kind: 'plant', id: 'z' },
        ],
      },
    )

    expect(command?.after.selection).toEqual([
      { kind: 'zone', id: 'é' },
      { kind: 'plant', id: 'z' },
    ])
  })
})
