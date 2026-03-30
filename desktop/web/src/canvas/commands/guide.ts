import Konva from 'konva'
import type { Command } from '../history'
import type { CanvasEngine } from '../engine'
import { guides } from '../../state/canvas'
import { createGuideLine, type Guide } from '../guides'

/** Add a guide line — undoable. */
export class AddGuideCommand implements Command {
  readonly type = 'addGuide'
  readonly dirtyPasses = ['annotations', 'overlays'] as const
  private _guide: Guide

  constructor(guide: Guide) {
    this._guide = guide
  }

  execute(engine: CanvasEngine): void {
    guides.value = [...guides.value, this._guide]
    const layer = engine.layers.get('annotations')
    if (layer) {
      const line = createGuideLine(this._guide, engine.stage)
      layer.add(line as unknown as Konva.Shape)
      layer.batchDraw()
    }
  }

  undo(engine: CanvasEngine): void {
    guides.value = guides.value.filter((g) => g.id !== this._guide.id)
    const layer = engine.layers.get('annotations')
    if (layer) {
      layer.find('.guide-line').forEach((n) => {
        if (n.getAttr('data-guide-id') === this._guide.id) n.destroy()
      })
      layer.batchDraw()
    }
  }
}

/** Remove a guide line — undoable. */
export class RemoveGuideCommand implements Command {
  readonly type = 'removeGuide'
  readonly dirtyPasses = ['annotations', 'overlays'] as const
  private _guide: Guide

  constructor(guide: Guide) {
    this._guide = guide
  }

  execute(engine: CanvasEngine): void {
    guides.value = guides.value.filter((g) => g.id !== this._guide.id)
    const layer = engine.layers.get('annotations')
    if (layer) {
      layer.find('.guide-line').forEach((n) => {
        if (n.getAttr('data-guide-id') === this._guide.id) n.destroy()
      })
      layer.batchDraw()
    }
  }

  undo(engine: CanvasEngine): void {
    guides.value = [...guides.value, this._guide]
    const layer = engine.layers.get('annotations')
    if (layer) {
      const line = createGuideLine(this._guide, engine.stage)
      layer.add(line as unknown as Konva.Shape)
      layer.batchDraw()
    }
  }
}
