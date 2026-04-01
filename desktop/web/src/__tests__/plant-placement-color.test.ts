import { beforeEach, describe, expect, it } from 'vitest'
import Konva from 'konva'
import { CanvasEngine } from '../canvas/engine'
import { plantSpeciesColors } from '../state/canvas'

describe('plant placement color defaults', () => {
  beforeEach(() => {
    plantSpeciesColors.value = {}
  })

  it('seeds new plant placements from the document species color default', () => {
    plantSpeciesColors.value = { 'Malus domestica': '#C44230' }

    const engine = {
      stage: { scaleX: () => 1 },
      getPlantSpeciesColor: CanvasEngine.prototype.getPlantSpeciesColor,
    } as unknown as CanvasEngine

    const plantNode = CanvasEngine.prototype.createPlantPlacementNode.call(engine, {
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      stratum: 'high',
      canopySpreadM: 4,
      position: { x: 10, y: 20 },
    })

    expect(plantNode.getAttr('data-color-override')).toBe('#C44230')
    const circle = plantNode.findOne('.plant-circle')
    expect(circle).toBeInstanceOf(Konva.Circle)
    expect((circle as Konva.Circle).fill()).toBe('#C44230')
  })
})
