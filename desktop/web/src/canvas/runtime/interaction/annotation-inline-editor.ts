import { getAnnotationScreenFrame } from '../annotation-layout'
import type { CameraController } from '../camera'
import type { SceneAnnotationEntity, SceneStateReader } from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'

export interface AnnotationInlineEditorContext {
  readonly container: HTMLElement
  readonly camera: CameraController
  readonly getSceneStore: () => SceneStateReader
  readonly sceneEdits: SceneEditCoordinator
  readonly canEditAnnotation: (annotationId: string) => boolean
  readonly refreshSelectionDependent: () => void
}

export interface AnnotationInlineEditorController {
  readonly hasActiveEditor: () => boolean
  readonly contains: (target: EventTarget | null) => boolean
  readonly start: (annotationId: string) => boolean
  readonly commit: () => void
  readonly cancel: () => void
  readonly refresh: () => void
  readonly dispose: () => void
}

interface ActiveAnnotationEditor {
  readonly annotationId: string
  readonly textarea: HTMLTextAreaElement
}

export function createAnnotationInlineEditor(
  context: AnnotationInlineEditorContext,
): AnnotationInlineEditorController {
  let active: ActiveAnnotationEditor | null = null

  function start(annotationId: string): boolean {
    if (active?.annotationId === annotationId) {
      active.textarea.focus()
      active.textarea.select()
      return true
    }
    if (active) {
      commit()
      if (active) return false
    }

    const annotation = findAnnotation(annotationId)
    if (!annotation || annotation.annotationType !== 'text') return false

    const textarea = document.createElement('textarea')
    textarea.value = annotation.text
    textarea.dataset.annotationInlineEditor = 'true'
    textarea.dataset.preserveOverlays = 'true'
    active = {
      annotationId,
      textarea,
    }

    applyTextareaChrome(textarea, annotation)
    positionTextarea(textarea, annotation)
    context.container.appendChild(textarea)
    autosizeTextarea(textarea)

    requestAnimationFrame(() => {
      if (active?.textarea !== textarea) return
      textarea.focus()
      textarea.select()
    })

    textarea.addEventListener('input', () => autosizeTextarea(textarea))
    textarea.addEventListener('blur', () => {
      requestAnimationFrame(() => {
        if (active?.textarea === textarea) commit()
      })
    })
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancel()
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        commit()
      }
    })

    return true
  }

  function commit(): void {
    const edit = active
    if (!edit) return
    const rawText = edit.textarea.value

    const annotation = findAnnotation(edit.annotationId)
    if (!annotation || !context.canEditAnnotation(edit.annotationId)) {
      cleanup()
      return
    }
    if (rawText.trim().length === 0) {
      context.sceneEdits.run('interaction-annotation-text', (tx) => {
        tx.mutate((draft) => {
          draft.annotations = draft.annotations.filter((entry) => entry.id !== edit.annotationId)
          draft.groups = draft.groups
            .map((group) => ({
              ...group,
              members: group.members.filter((member) =>
                !(member.kind === 'annotation' && member.id === edit.annotationId),
              ),
            }))
            .filter((group) => group.members.length >= 2)
        })
        tx.setSelection([])
      }, {
        onCommitted: () => {
          cleanup()
          context.refreshSelectionDependent()
        },
      })
      return
    }

    if (rawText === annotation.text) {
      cleanup()
      return
    }
    context.sceneEdits.run('interaction-annotation-text', (tx) => {
      tx.mutate((draft) => {
        draft.annotations = draft.annotations.map((entry) => (
          entry.id === edit.annotationId ? { ...entry, text: rawText } : entry
        ))
      })
    }, {
      onCommitted: () => {
        cleanup()
        context.refreshSelectionDependent()
      },
    })
  }

  function cancel(): void {
    cleanup()
  }

  function refresh(): void {
    const edit = active
    if (!edit) return
    const annotation = findAnnotation(edit.annotationId)
    if (!annotation) {
      cleanup()
      return
    }
    applyTextareaChrome(edit.textarea, annotation)
    positionTextarea(edit.textarea, annotation)
    autosizeTextarea(edit.textarea)
  }

  function cleanup(): void {
    active?.textarea.remove()
    active = null
  }

  function contains(target: EventTarget | null): boolean {
    if (!active || !(target instanceof Node)) return false
    return active.textarea === target || active.textarea.contains(target)
  }

  function findAnnotation(annotationId: string): SceneAnnotationEntity | null {
    return context.getSceneStore().persisted.annotations.find((entry) => entry.id === annotationId) ?? null
  }

  return {
    hasActiveEditor: () => active !== null,
    contains,
    start,
    commit,
    cancel,
    refresh,
    dispose: cancel,
  }

  function applyTextareaChrome(textarea: HTMLTextAreaElement, annotation: SceneAnnotationEntity): void {
    Object.assign(textarea.style, {
      position: 'absolute',
      minWidth: '120px',
      minHeight: '24px',
      padding: '2px 4px',
      background: 'var(--color-surface)',
      border: '1px solid var(--color-primary)',
      borderRadius: 'var(--radius-sm)',
      outline: 'none',
      resize: 'none',
      overflow: 'hidden',
      fontFamily: 'var(--font-sans, Inter, system-ui, sans-serif)',
      fontSize: `${annotation.fontSize}px`,
      lineHeight: '1.25',
      color: 'var(--color-text)',
      zIndex: '3',
      whiteSpace: 'pre',
      transformOrigin: 'top left',
    })
  }

  function positionTextarea(textarea: HTMLTextAreaElement, annotation: SceneAnnotationEntity): void {
    const frame = getAnnotationScreenFrame(annotation, context.camera.viewport)
    Object.assign(textarea.style, {
      left: `${frame.origin.x}px`,
      top: `${frame.origin.y}px`,
      width: `${Math.max(frame.widthPx + 8, 120)}px`,
      minHeight: `${Math.max(frame.heightPx + 4, 24)}px`,
      transform: frame.rotationDeg === 0 ? '' : `rotate(${frame.rotationDeg}deg)`,
    })
  }

  function autosizeTextarea(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.max(textarea.scrollHeight, 24)}px`
  }
}
