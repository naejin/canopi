import type { CameraController } from '../camera'
import type { ScenePoint } from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import { appendTextAnnotationToDraft } from './tool-actions'
import type { SceneToolAdapter } from './tool-adapter'

export interface TextAnnotationToolContext {
  readonly container: HTMLElement
  readonly camera: CameraController
  readonly sceneEdits: SceneEditCoordinator
}

export interface TextAnnotationTool {
  readonly hasActiveEditor: () => boolean
  readonly pointerDown: (world: ScenePoint) => void
  readonly cancel: () => void
  readonly dispose: () => void
}

export function createTextAnnotationTool(context: TextAnnotationToolContext): TextAnnotationTool {
  let textarea: HTMLTextAreaElement | null = null
  let textWorldPosition: ScenePoint | null = null

  function pointerDown(world: ScenePoint): void {
    if (textarea) {
      commitText()
      return
    }
    textWorldPosition = world
    spawnTextarea(world)
  }

  function spawnTextarea(world: ScenePoint): void {
    const nextTextarea = document.createElement('textarea')
    const screen = context.camera.worldToScreen(world)
    textarea = nextTextarea

    Object.assign(nextTextarea.style, {
      position: 'absolute',
      left: `${screen.x}px`,
      top: `${screen.y}px`,
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
      fontSize: 'var(--text-base)',
      lineHeight: '1.4',
      color: 'var(--color-text)',
      zIndex: '3',
      whiteSpace: 'pre',
    })

    context.container.appendChild(nextTextarea)
    requestAnimationFrame(() => {
      if (textarea !== nextTextarea) return
      nextTextarea.focus()
      nextTextarea.addEventListener('input', () => {
        nextTextarea.style.height = 'auto'
        nextTextarea.style.height = `${nextTextarea.scrollHeight}px`
      })
      nextTextarea.addEventListener('blur', () => {
        requestAnimationFrame(() => {
          if (textarea === nextTextarea) commitText()
        })
      })
    })
    nextTextarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancel()
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        commitText()
      }
    })
  }

  function commitText(): void {
    const activeTextarea = textarea
    const position = textWorldPosition
    if (!activeTextarea || !position) {
      cancel()
      return
    }

    const text = activeTextarea.value.trim()
    cancel()
    if (!text) return

    context.sceneEdits.run('interaction-text', (tx) => {
      let nextId = ''
      tx.mutate((draft) => {
        nextId = appendTextAnnotationToDraft(draft, position, text)
      })
      tx.setSelection([nextId])
    })
  }

  function cancel(): void {
    textarea?.remove()
    textarea = null
    textWorldPosition = null
  }

  return {
    hasActiveEditor: () => textarea !== null,
    pointerDown,
    cancel,
    dispose: cancel,
  }
}

export function createTextAnnotationToolAdapter(tool: TextAnnotationTool): SceneToolAdapter {
  return {
    onDeactivate: tool.cancel,
    shouldSuppressSharedKeyboard: tool.hasActiveEditor,
    pointerDown({ event, rawWorld }) {
      event.preventDefault()
      tool.pointerDown(rawWorld)
      return true
    },
    dispose: tool.dispose,
  }
}
