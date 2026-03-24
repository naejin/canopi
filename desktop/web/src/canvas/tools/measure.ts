import Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasEngine } from '../engine'
import { PREVIEW_DASH } from '../shapes'
import { AddNodeCommand } from '../commands'
import { locale } from '../../state/app'

// 1 canvas unit = 1 metre at the default scale.
const MEASURE_STROKE = '#64748B'
const LABEL_BG = '#475569'
const LABEL_TEXT_COLOR = '#FFFFFF'
const LABEL_FONT = 'Inter, sans-serif'
const LABEL_FONT_SIZE = 12
const LABEL_PAD_X = 6
const LABEL_PAD_Y = 3

function formatDistance(canvasUnits: number): string {
  const formatted = new Intl.NumberFormat(locale.value, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(canvasUnits)
  return `${formatted} m`
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2)
}

// -------------------------------------------------------------------------
// Mutable label — a group containing a pill rect + text node.
// Call update(text) to change the label without destroying nodes.
// -------------------------------------------------------------------------

interface MutableLabel {
  group: Konva.Group
  pill: Konva.Rect
  textNode: Konva.Text
  update(text: string): void
}

function createMutableLabel(initialText: string): MutableLabel {
  const textNode = new Konva.Text({
    text: initialText,
    fontSize: LABEL_FONT_SIZE,
    fontFamily: LABEL_FONT,
    fill: LABEL_TEXT_COLOR,
    listening: false,
  })

  const tw = textNode.width()
  const th = textNode.height()

  const pill = new Konva.Rect({
    x: -(tw / 2 + LABEL_PAD_X),
    y: -(th / 2 + LABEL_PAD_Y),
    width: tw + LABEL_PAD_X * 2,
    height: th + LABEL_PAD_Y * 2,
    fill: LABEL_BG,
    cornerRadius: 4,
    listening: false,
  })

  textNode.x(-tw / 2)
  textNode.y(-th / 2)

  const group = new Konva.Group({ listening: false })
  group.add(pill)
  group.add(textNode)

  return {
    group,
    pill,
    textNode,
    update(text: string) {
      this.textNode.text(text)
      const w = this.textNode.width()
      const h = this.textNode.height()
      this.pill.setAttrs({
        x: -(w / 2 + LABEL_PAD_X),
        y: -(h / 2 + LABEL_PAD_Y),
        width: w + LABEL_PAD_X * 2,
        height: h + LABEL_PAD_Y * 2,
      })
      this.textNode.x(-w / 2)
      this.textNode.y(-h / 2)
    },
  }
}

export class MeasureTool implements CanvasTool {
  readonly name = 'measure'
  readonly cursor = 'crosshair'

  private _phase: 'idle' | 'first-placed' = 'idle'
  private _startX = 0
  private _startY = 0

  // Preview objects — created on first click, mutated on mousemove
  private _previewGroup: Konva.Group | null = null
  private _previewLine: Konva.Line | null = null
  private _previewLabel: MutableLabel | null = null

  // rAF throttle
  private _rafId: number | null = null
  private _pendingPos: { x: number; y: number } | null = null

  activate(_engine: CanvasEngine): void {}

  deactivate(engine: CanvasEngine): void {
    this._cancelMeasure(engine)
  }

  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (e.evt.button !== 0) return

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    if (this._phase === 'idle') {
      this._startX = pos.x
      this._startY = pos.y
      this._phase = 'first-placed'

      const previewLine = new Konva.Line({
        points: [pos.x, pos.y, pos.x, pos.y],
        stroke: MEASURE_STROKE,
        strokeWidth: 1.5,
        strokeScaleEnabled: false,
        dash: PREVIEW_DASH,
        listening: false,
      })

      const previewLabel = createMutableLabel('0.0 m')
      previewLabel.group.position({ x: pos.x, y: pos.y })
      // Counter-scale so the pill stays at a fixed screen size
      const inv = 1 / engine.stage.scaleX()
      previewLabel.group.scale({ x: inv, y: inv })

      const group = new Konva.Group({ listening: false })
      group.add(previewLine)
      group.add(previewLabel.group)

      this._previewLine = previewLine
      this._previewLabel = previewLabel
      this._previewGroup = group

      const layer = engine.layers.get('annotations')
      if (layer) {
        layer.add(group as unknown as Konva.Shape)
        layer.batchDraw()
      }
    } else {
      // Second click — finalize
      this._finalize(pos.x, pos.y, engine)
    }
  }

  onMouseMove(_e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (this._phase !== 'first-placed' || !this._previewLine || !this._previewLabel) return

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    this._pendingPos = pos

    if (this._rafId !== null) return
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null
      if (!this._pendingPos || !this._previewLine || !this._previewLabel) return

      const { x, y } = this._pendingPos
      const d = dist(this._startX, this._startY, x, y)
      const midX = (this._startX + x) / 2
      const midY = (this._startY + y) / 2

      // Mutate existing nodes in place — no create/destroy per frame
      this._previewLine.points([this._startX, this._startY, x, y])
      this._previewLabel.group.position({ x: midX, y: midY })
      this._previewLabel.update(formatDistance(d))

      this._previewLine.getLayer()?.batchDraw()
    })
  }

  onMouseUp(_e: Konva.KonvaEventObject<MouseEvent>, _engine: CanvasEngine): void {
    // Managed by onMouseDown (two-click flow)
  }

  onKeyDown(e: KeyboardEvent, engine: CanvasEngine): void {
    if (e.key === 'Escape') {
      this._cancelMeasure(engine)
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private _finalize(endX: number, endY: number, engine: CanvasEngine): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }

    const sx = this._startX
    const sy = this._startY

    // Remove preview
    if (this._previewGroup) {
      this._previewGroup.destroy()
      this._previewGroup = null
      this._previewLine = null
      this._previewLabel = null
    }

    this._phase = 'idle'
    this._pendingPos = null

    const d = dist(sx, sy, endX, endY)
    if (d < 1) return // Ignore near-zero measurements

    const midX = (sx + endX) / 2
    const midY = (sy + endY) / 2

    // Build final group — solid line + persistent label
    const finalLine = new Konva.Line({
      points: [sx, sy, endX, endY],
      stroke: MEASURE_STROKE,
      strokeWidth: 1.5,
      strokeScaleEnabled: false,
    })

    const finalLabel = createMutableLabel(formatDistance(d))
    finalLabel.group.position({ x: midX, y: midY })
    // Counter-scale so the pill stays at a fixed screen size
    const finalInv = 1 / engine.stage.scaleX()
    finalLabel.group.scale({ x: finalInv, y: finalInv })

    const group = new Konva.Group({
      draggable: true,
      name: 'shape',
      id: crypto.randomUUID(),
    })
    group.add(finalLine)
    group.add(finalLabel.group)

    const cmd = new AddNodeCommand('annotations', group)
    engine.history.execute(cmd, engine)
  }

  private _cancelMeasure(_engine: CanvasEngine): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
    if (this._previewGroup) {
      const layer = this._previewGroup.getLayer()
      this._previewGroup.destroy()
      this._previewGroup = null
      this._previewLine = null
      this._previewLabel = null
      layer?.batchDraw()
    }
    this._phase = 'idle'
    this._pendingPos = null
  }
}
