// Edit › Cut and Delete from the menu bar and the palette (runCanvasIntent) honour the re-origin hold as the keys and the
// canvas menu do (U39): while a draft is live they delete nothing. The hold comes from a real interaction session.
import { describe, expect, it, vi } from 'vitest'
import { SceneStore } from '../canvas/runtime/scene'
import { setCurrentCanvasSession } from '../canvas/session'
import { runCanvasIntent } from '../app/workspace-commands/canvas-actions'
import type { CanvasCommandFrom } from '../app/canvas-commands'
import type { SceneInteractionEventHarness } from './support/canvas-interaction-events'
import type { TestView } from './support/test-view'
import {
  createInteractionDeps,
  installSceneInteractionFixture,
  makePlant,
  plantTarget,
} from './support/canvas-interaction-setup'
import {
  createTestCanvasCommandSurface,
  createTestCanvasDocumentSurface,
} from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'

describe('Edit › Cut and Delete during a draft (U39)', () => {
  let container: HTMLDivElement
  let testView: TestView
  let store: SceneStore
  let events: SceneInteractionEventHarness

  const { createTestSession } = installSceneInteractionFixture(
    (f) => {
      ({ container, testView, store, events } = f)
    },
    () => ({ events }),
  )

  it('the menu bar and the palette delete nothing while a polygon draft is live, and delete again after Esc', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 200, y: 200 })]
    })
    const deps = createInteractionDeps(container, store, testView)
    const session = createTestSession(deps)
    const copy = vi.fn()
    const deleteSelected = vi.fn()
    setCurrentCanvasSession({
      commands: createTestCanvasCommandSurface({ sceneEdits: { copy, deleteSelected } }),
      queries: createTestCanvasQuerySurface(),
      documents: createTestCanvasDocumentSurface(),
      keyboard: session.keyboard,
    })
    session.setTool('polygon')
    container.focus()
    events.pointerDown({ x: 20, y: 20 })
    events.pointerUp({ x: 20, y: 20 })
    events.pointerDown({ x: 80, y: 20 })
    events.pointerUp({ x: 80, y: 20 })
    deps.setSelection([plantTarget('plant-1')])

    for (const from of ['menu', 'palette'] satisfies CanvasCommandFrom[]) {
      runCanvasIntent({ type: 'edit', action: 'delete' }, from)
      runCanvasIntent({ type: 'edit', action: 'cut' }, from)
    }
    expect(deleteSelected).not.toHaveBeenCalled()
    expect(copy).not.toHaveBeenCalled()
    // Copy is not a delete: it still runs during the draft.
    runCanvasIntent({ type: 'edit', action: 'copy' }, 'menu')
    expect(copy).toHaveBeenCalledTimes(1)

    // Esc drops the draft: Edit › Delete deletes again.
    events.keyDown({ key: 'Escape', target: container })
    runCanvasIntent({ type: 'edit', action: 'delete' }, 'menu')
    expect(deleteSelected).toHaveBeenCalledTimes(1)
    session.dispose()
  })
})
