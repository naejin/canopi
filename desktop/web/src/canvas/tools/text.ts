import type Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasEngine } from '../engine'
import { createText } from '../shapes'
import { AddNodeCommand } from '../commands'

export class TextTool implements CanvasTool {
  readonly name = 'text'
  readonly cursor = 'text'

  private _textarea: HTMLTextAreaElement | null = null
  // Canvas-space position where the text node will be placed
  private _canvasPos: { x: number; y: number } | null = null

  activate(_engine: CanvasEngine): void {}

  deactivate(engine: CanvasEngine): void {
    this._removeTextarea(engine)
  }

  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (e.evt.button !== 0) return

    // If there's already an active textarea, commit it first
    if (this._textarea) {
      this._commitText(engine)
      return
    }

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    this._canvasPos = { x: pos.x, y: pos.y }

    this._spawnTextarea(pos, engine)
  }

  onMouseMove(_e: Konva.KonvaEventObject<MouseEvent>, _engine: CanvasEngine): void {}

  onMouseUp(_e: Konva.KonvaEventObject<MouseEvent>, _engine: CanvasEngine): void {}

  onKeyDown(e: KeyboardEvent, engine: CanvasEngine): void {
    if (e.key === 'Escape') {
      this._removeTextarea(engine)
    }
    // Enter without Shift commits; Shift+Enter inserts a newline (handled by textarea natively)
    if (e.key === 'Enter' && !e.shiftKey && this._textarea) {
      e.preventDefault()
      this._commitText(engine)
    }
  }

  // -------------------------------------------------------------------------
  // Textarea lifecycle
  // -------------------------------------------------------------------------

  private _spawnTextarea(
    canvasPos: { x: number; y: number },
    engine: CanvasEngine,
  ): void {
    const stage = engine.stage
    const container = stage.container()
    if (!container) return

    // Convert canvas coordinates to screen coordinates accounting for zoom/pan
    const scale = stage.scaleX()
    const stagePos = stage.position()
    const screenX = canvasPos.x * scale + stagePos.x
    const screenY = canvasPos.y * scale + stagePos.y

    // Read theme-aware colors from CSS variables on the container element
    const computedStyle = getComputedStyle(container)
    const bg = computedStyle.getPropertyValue('--color-surface').trim() || '#FFFFFF'
    const text = computedStyle.getPropertyValue('--color-text').trim() || '#1A1A1A'
    const border = computedStyle.getPropertyValue('--color-primary').trim() || '#2D5F3F'

    // Append to the container's parent (position:relative canvas area div) so
    // that absolute positioning is relative to the canvas area, not the viewport.
    const parent = container.parentElement ?? document.body
    const isRelativeParent = parent !== document.body

    const textarea = document.createElement('textarea')
    this._textarea = textarea

    // Base styles — theme-aware background, matching typography
    Object.assign(textarea.style, {
      position: 'absolute',
      left: `${isRelativeParent ? screenX : screenX}px`,
      top: `${isRelativeParent ? screenY : screenY}px`,
      minWidth: '120px',
      minHeight: '24px',
      padding: '2px 4px',
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: '4px',
      outline: 'none',
      resize: 'none',
      overflow: 'hidden',
      fontFamily: 'Inter, sans-serif',
      fontSize: '16px',
      lineHeight: '1.4',
      color: text,
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      zIndex: '1000',
      // Allow the textarea to grow with content
      whiteSpace: 'pre',
    })

    parent.appendChild(textarea)

    // Delay focus + blur listener to avoid the mousedown event immediately
    // stealing focus back from the textarea (which triggers blur → commit → remove)
    requestAnimationFrame(() => {
      if (this._textarea !== textarea) return  // already removed
      textarea.focus()

      // Auto-resize height as user types
      textarea.addEventListener('input', () => {
        textarea.style.height = 'auto'
        textarea.style.height = `${textarea.scrollHeight}px`
      })

      // Commit on blur (click elsewhere) — attached AFTER focus to avoid race
      textarea.addEventListener('blur', () => {
        // Another rAF to let any pending click handlers settle
        requestAnimationFrame(() => {
          if (this._textarea === textarea) {
            this._commitText(engine)
          }
        })
      })
    })

    // Keydown events bubble from textarea to window → engine._onKeyDown.
    // Intercept here to handle Enter/Escape without the window handler seeing them.
    const onKeydown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation()
        this._removeTextarea(engine)
      } else if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault()
        ev.stopPropagation()
        this._commitText(engine)
      }
    }
    textarea.addEventListener('keydown', onKeydown)
  }

  private _commitText(engine: CanvasEngine): void {
    const textarea = this._textarea
    const pos = this._canvasPos

    if (!textarea || !pos) {
      this._removeTextarea(engine)
      return
    }

    const text = textarea.value.trim()
    this._removeTextarea(engine)

    if (!text) return

    const shape = createText({ x: pos.x, y: pos.y, text })
    // Counter-scale so the text stays at a constant 16px screen size
    const inv = 1 / engine.stage.scaleX()
    shape.scale({ x: inv, y: inv })
    const cmd = new AddNodeCommand('annotations', shape)
    engine.history.execute(cmd, engine)
  }

  private _removeTextarea(engine: CanvasEngine): void {
    if (this._textarea) {
      this._textarea.remove()
      this._textarea = null
    }
    this._canvasPos = null
    // Restore tool cursor (the engine may have changed it)
    const container = engine.stage.container()
    if (container) container.style.cursor = this.cursor
  }
}
