// SceneInteractionSession tests, split by the first tool a test arms (canvas v2 plan §4, Seams):
// tests that arm Text, and the text note editor describe.
// Shared fakes, helpers and fixture: support/scene-interaction-setup.ts.
import { describe, expect, it, vi } from 'vitest'
import { t } from '../i18n'
import { CameraController } from '../canvas/runtime/camera'
import { SceneStore } from '../canvas/runtime/scene'
import { SceneHistory } from '../canvas/runtime/scene-history'
import { SceneRuntimeEditCoordinator } from '../canvas/runtime/scene-runtime/transactions'
import type { SceneInteractionEventHarness } from './support/scene-interaction-events'
import {
  createInteractionDeps,
  annotationTarget,
  nextAnimationFrame,
  captureWindowErrors,
  makeTextAnnotation,
  installSceneInteractionFixture,
} from './support/scene-interaction-setup'

describe('SceneInteractionSession', () => {
  let container: HTMLDivElement
  let camera: CameraController
  let store: SceneStore
  let events: SceneInteractionEventHarness

  const { createTestSession } = installSceneInteractionFixture(
    (f) => {
      ({ container, camera, store, events } = f)
    },
    () => ({ events }),
  )

  it('commits a text Annotation with Enter and selects it', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('text')

    events.pointerDown({ x: 24, y: 32 }, { button: 0 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Guild note'
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations).toHaveLength(1)
    expect(store.persisted.annotations[0]).toMatchObject({
      annotationType: 'text',
      position: { x: 24, y: 32 },
      text: 'Guild note',
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-text')
    expect(deps.setSelection).toHaveBeenCalledWith([
      annotationTarget(store.persisted.annotations[0]!.id),
    ])
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('keeps a new text Annotation draft recoverable while the Scene is busy', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('text')

    events.pointerDown({ x: 24, y: 32 }, { button: 0 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Deferred guild note'
    const active = deps.sceneEdits.begin('external-preview')

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBe(textarea)
    expect(textarea.value).toBe('Deferred guild note')

    active.abort()
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations).toEqual([
      expect.objectContaining({
        annotationType: 'text',
        position: { x: 24, y: 32 },
        text: 'Deferred guild note',
      }),
    ])
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-text')
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('does not create text Annotations on a locked Annotations Layer', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'annotations' ? { ...layer, locked: true } : layer
      ))
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('text')

    events.pointerDown({ x: 24, y: 32 }, { button: 0 })

    expect(container.querySelector('textarea')).toBeNull()
    expect(store.persisted.annotations).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('cancels a pending text Annotation with Escape', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('text')

    events.pointerDown({ x: 24, y: 32 }, { button: 0 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Draft note'
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(store.persisted.annotations).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('commits a pending text Annotation on blur', async () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('text')

    events.pointerDown({ x: 24, y: 32 }, { button: 0 })
    await nextAnimationFrame()
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Blurred note'
    textarea.dispatchEvent(new FocusEvent('blur'))
    await nextAnimationFrame()

    expect(store.persisted.annotations).toHaveLength(1)
    expect(store.persisted.annotations[0]).toMatchObject({
      position: { x: 24, y: 32 },
      text: 'Blurred note',
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-text')
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('does not commit empty text Annotations', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('text')

    events.pointerDown({ x: 24, y: 32 }, { button: 0 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = '   '
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('clears a committed text draft when a later event settles retained publication', () => {
    let invalidationFailures = 2
    const baseDeps = createInteractionDeps(container, store, camera)
    const sceneEdits = new SceneRuntimeEditCoordinator({
      sceneStore: store,
      history: new SceneHistory(),
      setSelection: baseDeps.setSelection,
      incrementSceneRevision: () => {},
      syncCanvasSignalsFromScene: () => {},
      invalidate: () => {
        if (invalidationFailures > 0) {
          invalidationFailures -= 1
          throw new Error('text publication failed')
        }
      },
    })
    const session = createTestSession({
      ...baseDeps,
      sceneEdits,
      commandAdmission: sceneEdits,
    })
    session.setTool('text')
    events.pointerDown({ x: 24, y: 32 }, { button: 0 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Retained note'

    const errors = captureWindowErrors(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(errors).toHaveLength(1)
    expect(store.persisted.annotations).toHaveLength(1)
    expect(container.querySelector('textarea')).toBe(textarea)

    const recoveryPointerDown = events.pointerDown({ x: 80, y: 90 }, { button: 0 })

    expect(recoveryPointerDown.defaultPrevented).toBe(true)
    expect(store.persisted.annotations).toHaveLength(1)
    expect(container.querySelector('textarea')).toBeNull()
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(store.persisted.annotations).toHaveLength(1)
    session.dispose()
  })

  it('cleans up pending text Annotation editors on tool change and disposal', () => {
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('text')

    events.pointerDown({ x: 24, y: 32 }, { button: 0 })
    expect(container.querySelector('textarea')).not.toBeNull()
    session.setTool('select')
    expect(container.querySelector('textarea')).toBeNull()

    session.setTool('text')
    events.pointerDown({ x: 48, y: 64 }, { button: 0 })
    expect(container.querySelector('textarea')).not.toBeNull()
    session.dispose()
    expect(container.querySelector('textarea')).toBeNull()
  })

  it('keeps Space from starting canvas panning while a text Annotation editor is active', () => {
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('text')

    events.pointerDown({ x: 24, y: 32 }, { button: 0 })
    expect(container.querySelector('textarea')).not.toBeNull()
    expect(container.style.cursor).toBe('text')

    events.keyDown({
      key: ' ',
      code: 'Space',
      cancelable: true,
    })

    expect(container.style.cursor).toBe('text')
    session.dispose()
  })

  describe('text note editor', () => {
    it('names the new note field and prompts for the text, as the tool card does', () => {
      const session = createTestSession(createInteractionDeps(container, store, camera))
      session.setTool('text')

      events.pointerDown({ x: 24, y: 32 }, { button: 0 })

      const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
      expect(textarea.getAttribute('aria-label')).toBe(t('canvas.tools.text'))
      expect(textarea.placeholder).toBe(t('canvas.textNote.placeholder'))
      expect(t('canvas.tools.text')).toBe('Text note')
      expect(t('canvas.textNote.placeholder')).toBe('Type the note')
      session.dispose()
    })

    it('names the field that edits a note in place', () => {
      store.updatePersisted((draft) => {
        draft.annotations = [makeTextAnnotation('note-1', { x: 40, y: 40 }, 'Old')]
      })
      const deps = createInteractionDeps(container, store, camera)
      const session = createTestSession(deps)
      session.setTool('select')
      deps.setSelection([annotationTarget('note-1')])
      container.focus()

      events.keyDown({ key: 'Enter', target: container })

      expect(container.querySelector('textarea')?.getAttribute('aria-label')).toBe(t('canvas.tools.text'))
      session.dispose()
    })
  })
})
