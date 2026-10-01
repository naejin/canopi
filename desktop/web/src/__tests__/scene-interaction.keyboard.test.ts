// SceneInteractionSession tests, split by the first tool a test arms (canvas v2 plan §4, Seams):
// tests that arm no tool and drive keys, and the keyboard access, Esc chain and
// arrow-key nudge describes.
// Shared fakes, helpers and fixture: support/scene-interaction-setup.ts.
import { describe, expect, it, vi } from 'vitest'
import { t } from '../i18n'
import { CameraController } from '../canvas/runtime/camera'
import { SceneStore } from '../canvas/runtime/scene'
import type {
  SceneInteractionSession,
  SceneInteractionSessionDeps,
} from '../canvas/runtime/interaction-session'
import { createRecordingRenderer } from './support/recording-renderer'
import type { SceneInteractionEventHarness } from './support/scene-interaction-events'
import {
  contextMenuHost,
  createInteractionDeps,
  plantTarget,
  zoneTarget,
  annotationTarget,
  makePlant,
  makeRectZone,
  makeTextAnnotation,
  getDesignObjectSelectionFromStore,
  installSceneInteractionFixture,
} from './support/scene-interaction-setup'

describe('SceneInteractionSession', () => {
  let container: HTMLDivElement
  let camera: CameraController
  let store: SceneStore
  let events: SceneInteractionEventHarness

  const { createTestSession, spacingInput } = installSceneInteractionFixture(
    (f) => {
      ({ container, camera, store, events } = f)
    },
    () => ({ events }),
  )

  it('aborts an active Rotation Handle drag on Escape without creating history', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const session = createTestSession(deps)
    deps.setSelection([zoneTarget('zone-1')])
    session.refreshMeasurements()

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const start = {
      x: Number.parseFloat(handle.style.left) + 14,
      y: Number.parseFloat(handle.style.top) + 14,
    }

    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 128, y: 110 }, { button: 0 })
    expect(store.persisted.zones[0]?.rotationDeg).toBeCloseTo(90)

    events.keyDown({ key: 'Escape', code: 'Escape' })
    events.pointerUp({ x: 128, y: 110 }, { button: 0 })

    expect(store.persisted.zones[0]?.rotationDeg).toBe(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLElement>('[data-rotation-handle-readout]')?.style.display).toBe('none')
    session.dispose()
  })

  it('opens the empty-map menu mid-map from the keyboard without a selection', () => {
    const session = createTestSession(createInteractionDeps(container, store, camera))
    container.tabIndex = -1
    container.focus()

    events.keyDown({ key: 'ContextMenu', cancelable: true, target: container })

    const request = contextMenuHost.current!
    expect(request.selection).toBeNull()
    expect(request.anchor).toEqual({ left: 200, top: 150, right: 200, bottom: 150 })
    expect(request.world).toEqual({ x: 200, y: 150 })
    session.dispose()
  })

  describe('keyboard access to the map', () => {
    it('puts the map host in the Tab order with an accessible name and a description of its keys', () => {
      const session = createTestSession(createInteractionDeps(container, store, camera))

      expect(container.tabIndex).toBe(0)
      expect(container.getAttribute('role')).toBe('application')
      expect(container.getAttribute('aria-label')).toBe(t('canvas.map.label'))
      const descriptionId = container.getAttribute('aria-describedby')
      expect(descriptionId).toBeTruthy()
      expect(document.getElementById(descriptionId!)?.textContent).toBe(t('canvas.map.description'))
      // It names every key the map takes: tools, the menu, arrows, F6 and Esc.
      expect(t('canvas.map.description')).toContain('Arrow keys move the selection 10 cm, or 1 m with Shift')
      expect(t('canvas.map.description')).toContain('F6')
      session.dispose()
    })

    it('restores the host when the session ends', () => {
      container.setAttribute('aria-label', 'Before')
      const session = createTestSession(createInteractionDeps(container, store, camera))

      session.dispose()

      expect(container.hasAttribute('tabindex')).toBe(false)
      expect(container.hasAttribute('role')).toBe(false)
      expect(container.hasAttribute('aria-describedby')).toBe(false)
      expect(container.getAttribute('aria-label')).toBe('Before')
    })

    it('refreshes the accessible name and description in place on a locale change', () => {
      let language = 'en'
      const translate = (key: string): string => `${language}:${key}`
      const session = createTestSession(createInteractionDeps(container, store, camera, { translate }))
      const description = document.getElementById(container.getAttribute('aria-describedby')!)

      language = 'fr'
      session.refreshTranslations()

      expect(container.getAttribute('aria-label')).toBe('fr:canvas.map.label')
      expect(document.getElementById(container.getAttribute('aria-describedby')!)).toBe(description)
      expect(description?.textContent).toBe('fr:canvas.map.description')
      session.dispose()
    })

    it('opens the right-click menu with Shift F10 after Tab focus, with no pointer press first', () => {
      store.updatePersisted((draft) => {
        draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
      })
      const deps = createInteractionDeps(container, store, camera)
      const session = createTestSession(deps)
      deps.setSelection([plantTarget('plant-1')])

      container.focus()
      expect(document.activeElement).toBe(container)
      events.keyDown({ key: 'F10', shiftKey: true, target: container })

      expect(contextMenuHost.current).not.toBeNull()
      session.dispose()
    })

    it('keeps focusing the host on a pointer press', () => {
      const session = createTestSession(createInteractionDeps(container, store, camera))
      session.setTool('select')

      events.pointerDown({ x: 40, y: 40 })

      expect(document.activeElement).toBe(container)
      session.dispose()
    })
  })

  describe('the Esc chain', () => {
    function escapeOnMap(): KeyboardEvent {
      return events.keyDown({ key: 'Escape', target: container })
    }

    function sessionWithToolLog(
      renderer?: SceneInteractionSessionDeps['renderer'],
    ): { session: SceneInteractionSession, deps: SceneInteractionSessionDeps, tools: string[] } {
      const tools: string[] = []
      const deps = createInteractionDeps(container, store, camera, { setTool: (name: string) => { tools.push(name) } })
      return { session: createTestSession(renderer ? { ...deps, renderer } : deps), deps, tools }
    }

    it.each([
      'hand',
      'plant-stamp',
      'plant-spacing',
      'object-stamp',
      'polygon',
      'rectangle',
      'ellipse',
      'line',
      'text',
      'measurement-guide',
    ])('returns %s to Select, then clears the selection', (tool) => {
      store.updatePersisted((draft) => {
        draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 200, y: 200 })]
      })
      const { session, deps, tools } = sessionWithToolLog()
      session.setTool(tool)
      deps.setSelection([plantTarget('plant-1')])
      container.focus()

      const first = escapeOnMap()
      expect(first.defaultPrevented).toBe(true)
      expect(tools.at(-1)).toBe('select')
      expect(deps.clearSelection).not.toHaveBeenCalled()

      const second = escapeOnMap()
      expect(second.defaultPrevented).toBe(true)
      expect(deps.clearSelection).toHaveBeenCalledTimes(1)

      const third = escapeOnMap()
      expect(third.defaultPrevented).toBe(false)
      session.dispose()
    })

    it('leaves Esc alone when the map does not have focus', () => {
      const { session, tools } = sessionWithToolLog()
      session.setTool('rectangle')
      const field = document.createElement('div')
      document.body.appendChild(field)

      const event = events.keyDown({ key: 'Escape', target: field })

      expect(event.defaultPrevented).toBe(false)
      expect(tools).not.toContain('select')
      field.remove()
      session.dispose()
    })

    it('cancels a new text note, returns focus to the map, then returns to Select', () => {
      const { session, tools } = sessionWithToolLog()
      session.setTool('text')
      events.pointerDown({ x: 24, y: 32 }, { button: 0 })
      const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
      textarea.focus()

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

      expect(container.querySelector('textarea')).toBeNull()
      expect(document.activeElement).toBe(container)
      expect(tools).not.toContain('select')
      escapeOnMap()
      expect(tools.at(-1)).toBe('select')
      session.dispose()
    })

    it('lets a click inside a new text note field move the caret instead of committing the note', () => {
      const { session } = sessionWithToolLog()
      session.setTool('text')
      events.pointerDown({ x: 24, y: 32 }, { button: 0 })
      const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
      textarea.focus()
      textarea.value = 'Mulch in November'

      const event = events.pointerDown({ x: 30, y: 36 }, { button: 0, target: textarea })

      expect(event.defaultPrevented).toBe(false)
      expect(container.querySelector('textarea')).toBe(textarea)
      expect(document.activeElement).toBe(textarea)
      expect(store.persisted.annotations).toHaveLength(0)
      session.dispose()
    })

    it('returns focus to the map after a text note is finished with Enter', () => {
      const { session } = sessionWithToolLog()
      session.setTool('text')
      events.pointerDown({ x: 24, y: 32 }, { button: 0 })
      const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
      textarea.focus()
      textarea.value = 'Mulch in November'

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

      expect(store.persisted.annotations).toHaveLength(1)
      expect(document.activeElement).toBe(container)
      session.dispose()
    })

    it('returns focus to the map after editing a note in place', () => {
      store.updatePersisted((draft) => {
        draft.annotations = [makeTextAnnotation('note-1', { x: 40, y: 40 }, 'Old')]
      })
      const deps = createInteractionDeps(container, store, camera)
      const session = createTestSession(deps)
      session.setTool('select')
      deps.setSelection([annotationTarget('note-1')])
      container.focus()
      events.keyDown({ key: 'Enter', target: container })
      const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
      textarea.focus()

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

      expect(container.querySelector('textarea')).toBeNull()
      expect(document.activeElement).toBe(container)
      session.dispose()
    })

    it('cancels a polygon draft first, then returns to Select', () => {
      const { session, tools } = sessionWithToolLog()
      session.setTool('polygon')
      container.focus()
      events.pointerDown({ x: 20, y: 20 })
      events.pointerUp({ x: 20, y: 20 })
      events.pointerDown({ x: 80, y: 20 })
      events.pointerUp({ x: 80, y: 20 })

      escapeOnMap()
      expect(tools).not.toContain('select')
      expect(document.activeElement).toBe(container)

      escapeOnMap()
      expect(tools.at(-1)).toBe('select')
      session.dispose()
    })

    it('cancels a zone drag first, then returns to Select', () => {
      const { session, tools } = sessionWithToolLog()
      session.setTool('rectangle')
      events.pointerDown({ x: 20, y: 20 })
      events.pointerMove({ x: 80, y: 60 })

      escapeOnMap()
      expect(tools).not.toContain('select')
      expect(store.persisted.zones).toHaveLength(0)
      expect(document.activeElement).toBe(container)

      escapeOnMap()
      expect(tools.at(-1)).toBe('select')
      session.dispose()
    })

    it('drops the Plant a row source from its spacing field, returns focus to the map, then returns to Select', () => {
      store.updatePersisted((draft) => {
        draft.plants = [makePlant('source', 'Malus domestica', { x: 20, y: 30 })]
      })
      // The row's source ring draws in the session's draft sink (plan §1, exception 2), not the DOM.
      const drafts = createRecordingRenderer()
      const { session, tools } = sessionWithToolLog(drafts)
      session.setTool('plant-spacing')
      events.pointerDown({ x: 20, y: 30 })
      events.pointerUp({ x: 20, y: 30 })
      expect(drafts.lastDraft()?.shapes.some((shape) => shape.kind === 'circle-px')).toBe(true)
      const input = spacingInput()!
      input.focus()

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

      expect(drafts.lastDraft()).toBeNull()
      expect(document.activeElement).toBe(container)
      expect(tools).not.toContain('select')
      escapeOnMap()
      expect(tools.at(-1)).toBe('select')
      session.dispose()
    })
  })

  describe('arrow-key nudges', () => {
    function nudgeSession(selected = true): { nudge: { nudgeSelected: ReturnType<typeof vi.fn>, endNudge: ReturnType<typeof vi.fn> }, session: SceneInteractionSession, deps: SceneInteractionSessionDeps, render: ReturnType<typeof vi.fn> } {
      const nudge = { nudgeSelected: vi.fn(() => true), endNudge: vi.fn() }
      const render = vi.fn()
      const deps = createInteractionDeps(container, store, camera, { nudge, render })
      const session = createTestSession(deps)
      if (selected) deps.setSelection([plantTarget('plant-1')])
      container.tabIndex = 0
      container.focus()
      return { nudge, session, deps, render }
    }

    it('pans the map 64 px per arrow, 256 px with Shift, when nothing is selected', () => {
      const { nudge, render } = nudgeSession(false)
      const before = camera.viewport
      render.mockClear()

      const right = events.keyDown({ key: 'ArrowRight', cancelable: true, target: container })
      expect(right.defaultPrevented).toBe(true)
      expect(camera.viewport).toEqual({ x: before.x - 64, y: before.y, scale: before.scale })
      expect(render).toHaveBeenCalledWith('viewport')

      events.keyDown({ key: 'ArrowDown', shiftKey: true, target: container })
      events.keyDown({ key: 'ArrowLeft', target: container })
      events.keyDown({ key: 'ArrowUp', target: container })
      expect(camera.viewport).toEqual({ x: before.x, y: before.y - 256 + 64, scale: before.scale })
      expect(nudge.nudgeSelected).not.toHaveBeenCalled()
      expect(nudge.endNudge).not.toHaveBeenCalled()
    })

    it('pans with an empty selection under any tool and in overview, but not from a field or with Ctrl', () => {
      const { session, deps } = nudgeSession(false)
      const before = camera.viewport
      session.setTool('polygon')
      events.keyDown({ key: 'ArrowRight', target: container })
      session.setTool('select')
      session.setOverviewMode(true)
      events.keyDown({ key: 'ArrowRight', target: container })
      session.setOverviewMode(false)
      expect(camera.viewport.x).toBe(before.x - 128)

      const field = document.createElement('textarea')
      container.append(field)
      field.focus()
      const inField = events.keyDown({ key: 'ArrowRight', cancelable: true, target: field })
      expect(inField.defaultPrevented).toBe(false)
      field.remove()
      container.focus()
      events.keyDown({ key: 'ArrowRight', ctrlKey: true, target: container })
      events.keyDown({ key: 'ArrowRight', altKey: true, target: container })
      expect(camera.viewport.x).toBe(before.x - 128)

      // With a selection the same key nudges instead.
      deps.setSelection([plantTarget('plant-1')])
      events.keyDown({ key: 'ArrowRight', target: container })
      expect(camera.viewport.x).toBe(before.x - 128)
      expect(deps.nudge!.nudgeSelected).toHaveBeenCalledExactlyOnceWith({ x: 0.1, y: 0 })
    })

    it('nudges the selection 0.1 m per arrow, 1 m with Shift, north-up', () => {
      const { nudge } = nudgeSession()
      const right = events.keyDown({ key: 'ArrowRight', cancelable: true, target: container })
      events.keyDown({ key: 'ArrowLeft', target: container })
      events.keyDown({ key: 'ArrowUp', shiftKey: true, target: container })
      events.keyDown({ key: 'ArrowDown', target: container })
      expect(right.defaultPrevented).toBe(true)
      expect(nudge.nudgeSelected.mock.calls.map(([delta]) => delta)).toEqual([
        { x: 0.1, y: 0 }, { x: -0.1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 0.1 },
      ])
      expect(nudge.endNudge).not.toHaveBeenCalled()
    })

    it('ends the series on another key, a press, leaving the map, a pause or a tool change', () => {
      vi.useFakeTimers()
      try {
        const { nudge, session, deps } = nudgeSession()
        events.keyDown({ key: 'ArrowRight', target: container })
        events.keyDown({ key: 'z', ctrlKey: true, target: container })
        expect(nudge.endNudge).toHaveBeenCalledTimes(1)
        expect(nudge.endNudge).toHaveBeenLastCalledWith()

        events.keyDown({ key: 'ArrowRight', target: container })
        events.pointerDown({ x: 200, y: 200 }, { button: 0 })
        expect(nudge.endNudge).toHaveBeenCalledTimes(2)
        events.pointerUp({ x: 200, y: 200 }, { button: 0 })
        // The press on empty map cleared the selection; the series needs one.
        deps.setSelection([plantTarget('plant-1')])

        events.keyDown({ key: 'ArrowRight', target: container })
        vi.advanceTimersByTime(1000)
        expect(nudge.endNudge).toHaveBeenCalledTimes(3)

        events.keyDown({ key: 'ArrowRight', target: container })
        container.dispatchEvent(new FocusEvent('focusout', { relatedTarget: document.body }))
        expect(nudge.endNudge).toHaveBeenCalledTimes(4)

        events.keyDown({ key: 'ArrowRight', target: container })
        session.setTool('polygon')
        expect(nudge.endNudge).toHaveBeenCalledTimes(5)
      } finally {
        vi.useRealTimers()
      }
    })

    it('cancels the series with Esc instead of clearing the selection', () => {
      const { nudge, deps } = nudgeSession()
      deps.setSelection([plantTarget('plant-1')])
      events.keyDown({ key: 'ArrowRight', target: container })
      events.keyDown({ key: 'Escape', cancelable: true, target: container })
      expect(nudge.endNudge).toHaveBeenCalledWith({ abort: true })
      expect(deps.clearSelection).not.toHaveBeenCalled()
      // The next Esc continues the chain.
      events.keyDown({ key: 'Escape', cancelable: true, target: container })
      expect(deps.clearSelection).toHaveBeenCalled()
    })

    it('leaves the arrows alone off the map, under other tools and with Ctrl or Alt', () => {
      const { nudge, session } = nudgeSession()
      const field = document.createElement('input')
      document.body.append(field)
      try {
        events.keyDown({ key: 'ArrowRight', target: field })
        events.keyDown({ key: 'ArrowRight', ctrlKey: true, target: container })
        events.keyDown({ key: 'ArrowRight', altKey: true, target: container })
        session.setTool('polygon')
        events.keyDown({ key: 'ArrowRight', target: container })
        expect(nudge.nudgeSelected).not.toHaveBeenCalled()
      } finally {
        field.remove()
      }
    })
  })
})
