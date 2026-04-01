import Konva from 'konva'
import type { CanvasEngine } from '../engine'
import type { Command } from '../history'

export class SetPlantColorCommand implements Command {
  readonly type = 'set-plant-color'
  readonly dirtyPasses = ['plant-display', 'lod', 'density', 'stacking'] as const

  constructor(
    private readonly _plantId: string,
    private readonly _from: string | null,
    private readonly _to: string | null,
  ) {}

  execute(engine: CanvasEngine): void {
    this._apply(engine, this._to)
  }

  undo(engine: CanvasEngine): void {
    this._apply(engine, this._from)
  }

  private _apply(engine: CanvasEngine, color: string | null): void {
    const plantsLayer = engine.layers.get('plants')
    if (!plantsLayer) return
    const group = plantsLayer.findOne('#' + this._plantId)
    if (!(group instanceof Konva.Group) || !group.hasName('plant-group')) return
    group.setAttr('data-color-override', color)
  }
}
