// Edit › Cut and Delete from the menu bar and the palette (runCanvasIntent) honour the re-origin hold as the keys and the
// canvas menu do (U39): while a draft is live they delete nothing, and the menu bar shows them disabled (S3b). The hold
// comes from a real interaction session, whose tool calls move the query revision's transient history as the runtime's do.
import { describe, expect, it, vi } from 'vitest'
import { SceneStore } from '../canvas/runtime/scene'
import { setCurrentCanvasSession } from '../canvas/session'
import { runCanvasIntent, workspaceCanvasCommandProjection } from '../app/workspace-commands/canvas-actions'
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
      queries: createTestCanvasQuerySurface({ selection: [plantTarget('plant-1')] }),
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
    setCurrentCanvasSession(null)
  })

  it('the menu bar greys Cut and Delete as the draft starts and enables them again after Esc', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 200, y: 200 })]
    })
    const queries = createTestCanvasQuerySurface({ selection: [plantTarget('plant-1')] })
    const deps = createInteractionDeps(container, store, testView)
    // As SceneCanvasRuntime wires it: each tool call moves the transient history the query revision exposes.
    deps.notifyTransientHistoryChange = () => queries.bumpTransientHistory()
    const session = createTestSession(deps)
    setCurrentCanvasSession({
      commands: createTestCanvasCommandSurface(),
      queries,
      documents: createTestCanvasDocumentSurface(),
      keyboard: session.keyboard,
    })
    deps.setSelection([plantTarget('plant-1')])
    const greyed = () => Object.fromEntries(workspaceCanvasCommandProjection.value.editActions
      .filter((command) => ['cut', 'copy', 'delete'].includes(command.id))
      .map((command) => [command.id, command.disabled]))
    expect(greyed()).toEqual({ cut: false, copy: false, delete: false })

    session.setTool('polygon')
    container.focus()
    events.pointerDown({ x: 20, y: 20 })
    events.pointerUp({ x: 20, y: 20 })
    events.pointerDown({ x: 80, y: 20 })
    events.pointerUp({ x: 80, y: 20 })
    // Edit › Select all during the draft reselects the plant, as in the live bug.
    deps.setSelection([plantTarget('plant-1')])
    expect(greyed()).toEqual({ cut: true, copy: false, delete: true })

    // Esc ends the draft and leaves the selection: only the transient history tells the menu bar.
    events.keyDown({ key: 'Escape', target: container })
    expect(greyed()).toEqual({ cut: false, copy: false, delete: false })
    session.dispose()
    setCurrentCanvasSession(null)
  })
})
