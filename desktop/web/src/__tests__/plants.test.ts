import Konva from 'konva'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCommonNames: vi.fn(async () => ({})),
}))

vi.mock('../ipc/species', () => ({
  getCommonNames: mocks.getCommonNames,
}))

import { createPlantNode, updatePlantLabelsForLocale } from '../canvas/plants'

describe('plant labels', () => {
  beforeEach(() => {
    mocks.getCommonNames.mockReset()
    mocks.getCommonNames.mockResolvedValue({})
  })

  it('creates only a single primary label when a common name exists', () => {
    const group = createPlantNode({
      id: 'plant-1',
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      stratum: 'low',
      canopySpreadM: null,
      position: { x: 10, y: 20 },
      stageScale: 8,
    })

    const label = group.findOne('.plant-label') as Konva.Text | undefined

    expect(label?.text()).toBe('Apple')
    expect(label?.fontStyle()).toBe('normal')
    expect(group.findOne('.plant-botanical')).toBeFalsy()
  })

  it('updates locale labels and removes any legacy botanical node', async () => {
    mocks.getCommonNames.mockResolvedValue({
      'Lavandula angustifolia': 'Lavande',
    })

    const group = createPlantNode({
      id: 'plant-2',
      canonicalName: 'Lavandula angustifolia',
      commonName: null,
      stratum: 'low',
      canopySpreadM: null,
      position: { x: 0, y: 0 },
      stageScale: 8,
    })

    group.add(new Konva.Text({
      name: 'plant-botanical',
      text: 'legacy',
    }))
    const layer = {
      find: vi.fn(() => [group]),
      batchDraw: vi.fn(),
    } as unknown as Konva.Layer

    await updatePlantLabelsForLocale(layer, 'fr')

    const label = group.findOne('.plant-label') as Konva.Text | undefined

    expect(mocks.getCommonNames).toHaveBeenCalledWith(['Lavandula angustifolia'], 'fr')
    expect(label?.text()).toBe('Lavande')
    expect(label?.fontStyle()).toBe('normal')
    expect(group.getAttr('data-common-name')).toBe('Lavande')
    expect(group.findOne('.plant-botanical')).toBeFalsy()
    expect(layer.batchDraw).toHaveBeenCalled()
  })
})
