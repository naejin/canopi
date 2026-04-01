import Konva from 'konva'
import type { CanvasCommandEngine, Command } from '../contracts'

export class SetPlantColorCommand implements Command {
  readonly type = 'set-plant-color'
  readonly dirtyPasses = ['plant-display', 'lod', 'density', 'stacking'] as const

  constructor(
    private readonly _plantId: string,
    private readonly _from: string | null,
    private readonly _to: string | null,
  ) {}

  execute(engine: CanvasCommandEngine): void {
    this._apply(engine, this._to)
  }

  undo(engine: CanvasCommandEngine): void {
    this._apply(engine, this._from)
  }

  private _apply(engine: CanvasCommandEngine, color: string | null): void {
    const plantsLayer = engine.layers.get('plants')
    if (!plantsLayer) return
    const group = plantsLayer.findOne('#' + this._plantId)
    if (!(group instanceof Konva.Group) || !group.hasName('plant-group')) return
    group.setAttr('data-color-override', color)
  }
}
