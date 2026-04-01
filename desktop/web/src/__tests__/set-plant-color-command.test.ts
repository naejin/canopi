import { describe, expect, it } from 'vitest'
import Konva from 'konva'
import { SetPlantColorCommand } from '../canvas/commands'

describe('SetPlantColorCommand', () => {
  it('applies and clears the plant color override through undo/redo semantics', () => {
    const group = new Konva.Group({ id: 'plant-1', name: 'plant-group shape' })
    const layer = new Konva.Layer()
    layer.add(group)

    const engine = {
      layers: new Map([['plants', layer]]),
    } as any

    const cmd = new SetPlantColorCommand('plant-1', null, '#C44230')
    cmd.execute(engine)
    expect(group.getAttr('data-color-override')).toBe('#C44230')

    cmd.undo(engine)
    expect(group.getAttr('data-color-override')).toBeUndefined()
  })
})
