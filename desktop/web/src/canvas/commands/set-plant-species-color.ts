import type { CanvasEngine } from '../engine'
import type { Command } from '../history'
import { plantSpeciesColors } from '../../state/canvas'

export class SetPlantSpeciesColorCommand implements Command {
  readonly type = 'set-plant-species-color'
  readonly dirtyPasses = ['plant-display', 'lod', 'density', 'stacking'] as const

  constructor(
    private readonly _canonicalName: string,
    private readonly _from: string | null,
    private readonly _to: string | null,
  ) {}

  execute(_engine: CanvasEngine): void {
    this._apply(this._to)
  }

  undo(_engine: CanvasEngine): void {
    this._apply(this._from)
  }

  private _apply(color: string | null): void {
    const nextSpeciesColors = { ...plantSpeciesColors.value }
    if (color) {
      nextSpeciesColors[this._canonicalName] = color
    } else {
      delete nextSpeciesColors[this._canonicalName]
    }
    plantSpeciesColors.value = nextSpeciesColors
  }
}
