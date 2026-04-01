import Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasToolEngine } from '../contracts'
import { plantStampSpecies } from '../../state/canvas'
import { AddNodeCommand } from '../commands'

export class PlantStampTool implements CanvasTool {
  readonly name = 'plant-stamp'
  readonly cursor = 'crosshair'

  activate(_engine: CanvasToolEngine): void {
    // Nothing — species is set via plantStampSpecies signal
  }

  deactivate(_engine: CanvasToolEngine): void {
    plantStampSpecies.value = null
  }

  onMouseDown(_e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasToolEngine): void {
    const species = plantStampSpecies.value
    if (!species) return

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    const plantNode = engine.createPlantPlacementNode({
      canonicalName: species.canonical_name,
      commonName: species.common_name,
      stratum: species.stratum,
      canopySpreadM: species.width_max_m,
      position: pos,
    })

    const cmd = new AddNodeCommand('plants', plantNode)
    engine.history.execute(cmd, engine)
  }

  onMouseMove(_e: Konva.KonvaEventObject<MouseEvent>, _engine: CanvasToolEngine): void {}
  onMouseUp(_e: Konva.KonvaEventObject<MouseEvent>, _engine: CanvasToolEngine): void {}

  onKeyDown(e: KeyboardEvent, _engine: CanvasToolEngine): void {
    if (e.key === 'Escape') {
      plantStampSpecies.value = null
    }
  }
}
