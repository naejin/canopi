import Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasEngine } from '../engine'
import { plantStampSpecies } from '../../state/canvas'
import { createPlantNode } from '../plants'
import { AddNodeCommand } from '../commands'

export class PlantStampTool implements CanvasTool {
  readonly name = 'plant-stamp'
  readonly cursor = 'crosshair'

  activate(_engine: CanvasEngine): void {
    // Nothing — species is set via plantStampSpecies signal
  }

  deactivate(_engine: CanvasEngine): void {
    plantStampSpecies.value = null
  }

  onMouseDown(_e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    const species = plantStampSpecies.value
    if (!species) return

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    const plantNode = createPlantNode({
      id: crypto.randomUUID(),
      canonicalName: species.canonical_name,
      commonName: species.common_name,
      stratum: species.stratum,
      canopySpreadM: species.width_max_m,
      position: pos,
      stageScale: engine.stage.scaleX(),
    })

    const cmd = new AddNodeCommand('plants', plantNode)
    engine.history.execute(cmd, engine)
  }

  onMouseMove(_e: Konva.KonvaEventObject<MouseEvent>, _engine: CanvasEngine): void {}
  onMouseUp(_e: Konva.KonvaEventObject<MouseEvent>, _engine: CanvasEngine): void {}

  onKeyDown(e: KeyboardEvent, engine: CanvasEngine): void {
    if (e.key === 'Escape') {
      plantStampSpecies.value = null
      engine.setActiveTool('select')
    }
  }
}
