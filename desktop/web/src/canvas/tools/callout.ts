import Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasEngine } from '../engine'
import { AddNodeCommand } from '../commands'

const CALLOUT_BG = 'rgba(255, 255, 255, 0.9)'
const CALLOUT_STROKE = '#64748B'
const CALLOUT_TEXT_COLOR = '#1e293b'
const CALLOUT_PADDING = 8
const CALLOUT_CORNER_RADIUS = 4
const DEFAULT_TEXT = 'Note'

export class CalloutTool implements CanvasTool {
  readonly name = 'callout'
  readonly cursor = 'crosshair'

  activate(_engine: CanvasEngine): void {}
  deactivate(_engine: CanvasEngine): void {}

  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (e.evt.button !== 0) return
    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    const inv = 1 / engine.stage.scaleX()

    // Build callout group: Rect background + Text
    const group = new Konva.Group({
      id: crypto.randomUUID(),
      x: pos.x,
      y: pos.y,
      draggable: true,
      name: 'shape annotation-callout',
      scaleX: inv,
      scaleY: inv,
    })

    const text = new Konva.Text({
      x: CALLOUT_PADDING,
      y: CALLOUT_PADDING,
      text: DEFAULT_TEXT,
      fontSize: 13,
      fontFamily: 'system-ui, sans-serif',
      fill: CALLOUT_TEXT_COLOR,
      listening: false,
    })

    const bg = new Konva.Rect({
      x: 0,
      y: 0,
      width: text.width() + CALLOUT_PADDING * 2,
      height: text.height() + CALLOUT_PADDING * 2,
      fill: CALLOUT_BG,
      stroke: CALLOUT_STROKE,
      strokeWidth: 1,
      cornerRadius: CALLOUT_CORNER_RADIUS,
      listening: false,
    })

    group.add(bg)
    group.add(text)

    // Double-click to edit text (same pattern as TextTool)
    group.on('dblclick', () => {
      _editCalloutText(group, text, bg, engine)
    })

    const cmd = new AddNodeCommand('annotations', group)
    engine.history.execute(cmd, engine)
  }

  onMouseMove(_e: Konva.KonvaEventObject<MouseEvent>, _engine: CanvasEngine): void {}
  onMouseUp(_e: Konva.KonvaEventObject<MouseEvent>, _engine: CanvasEngine): void {}

  onKeyDown(_e: KeyboardEvent, _engine: CanvasEngine): void {}
}

/** Open an HTML textarea overlay to edit callout text, then update the Konva nodes. */
function _editCalloutText(
  group: Konva.Group,
  textNode: Konva.Text,
  bgNode: Konva.Rect,
  engine: CanvasEngine,
): void {
  const stage = engine.stage
  const stageBox = stage.container().getBoundingClientRect()
  const groupAbsPos = group.getAbsolutePosition()
  const scale = stage.scaleX()
  const groupScale = group.scaleX()

  const textarea = document.createElement('textarea')
  textarea.value = textNode.text()
  Object.assign(textarea.style, {
    position: 'absolute',
    top: `${stageBox.top + groupAbsPos.y * scale / (scale * groupScale) + stageBox.top}px`,
    left: `${stageBox.left + groupAbsPos.x * scale / (scale * groupScale) + stageBox.left}px`,
    // Simplified positioning — place at the group's screen position
    width: `${(bgNode.width()) * groupScale * scale}px`,
    minHeight: `${(bgNode.height()) * groupScale * scale}px`,
    fontSize: `${13 * groupScale * scale}px`,
    fontFamily: 'system-ui, sans-serif',
    border: `1px solid ${CALLOUT_STROKE}`,
    borderRadius: `${CALLOUT_CORNER_RADIUS}px`,
    padding: `${CALLOUT_PADDING * groupScale * scale}px`,
    background: CALLOUT_BG,
    color: CALLOUT_TEXT_COLOR,
    outline: 'none',
    resize: 'both',
    overflow: 'auto',
    zIndex: '1000',
  })

  // Position more simply using absolute transform
  const absTransform = group.getAbsoluteTransform()
  const pos = absTransform.point({ x: 0, y: 0 })
  textarea.style.top = `${stageBox.top + pos.y}px`
  textarea.style.left = `${stageBox.left + pos.x}px`

  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  const finish = () => {
    const newText = textarea.value.trim() || DEFAULT_TEXT
    textNode.text(newText)
    // Resize background to fit new text
    bgNode.width(textNode.width() + CALLOUT_PADDING * 2)
    bgNode.height(textNode.height() + CALLOUT_PADDING * 2)
    textarea.remove()
    engine.layers.get('annotations')?.batchDraw()
  }

  textarea.addEventListener('blur', finish)
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      textarea.removeEventListener('blur', finish)
      textarea.remove()
    }
    // Shift+Enter for newlines, Enter to confirm
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      textarea.blur()
    }
  })
}
