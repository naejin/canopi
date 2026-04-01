import { describe, expect, it } from 'vitest'
import { plantSpeciesColors } from '../state/canvas'
import { SetPlantSpeciesColorCommand } from '../canvas/commands'

describe('SetPlantSpeciesColorCommand', () => {
  it('applies and clears the document species color through undo/redo semantics', () => {
    plantSpeciesColors.value = {}

    const cmd = new SetPlantSpeciesColorCommand('Malus domestica', null, '#C44230')
    cmd.execute({} as any)
    expect(plantSpeciesColors.value).toEqual({ 'Malus domestica': '#C44230' })

    cmd.undo({} as any)
    expect(plantSpeciesColors.value).toEqual({})
  })
})
