import { describe, expect, it, vi } from 'vitest'
import { updatePlantDisplay } from '../canvas/display-modes'
import { CIRCLE_SCREEN_PX, getStratumColor } from '../canvas/plants'
import { UNKNOWN_FLOWER_COLOR } from '../canvas/plant-colors'

function makePlantGroup(attrs: Record<string, unknown>) {
  const circle = {
    radius: vi.fn(),
    fill: vi.fn(),
  }

  const group = {
    getAttr: (name: string) => attrs[name],
    findOne: () => circle,
  }

  return { group, circle }
}

describe('updatePlantDisplay', () => {
  it('keeps missing-canopy plants at the default size at reference zoom and scales them with stage zoom', () => {
    const { group, circle } = makePlantGroup({
      'data-canonical-name': 'Malus domestica',
      'data-canopy-spread': 0,
      'data-stratum': 'medium',
    })
    const plantsLayer = {
      find: () => [group],
      batchDraw: vi.fn(),
    } as any

    updatePlantDisplay(plantsLayer, 'canopy', 'stratum', 8, 8, new Map())
    expect(circle.radius).toHaveBeenLastCalledWith(CIRCLE_SCREEN_PX)

    updatePlantDisplay(plantsLayer, 'canopy', 'stratum', 16, 8, new Map())
    expect(circle.radius).toHaveBeenLastCalledWith(CIRCLE_SCREEN_PX * 2)
    expect(circle.fill).toHaveBeenLastCalledWith(getStratumColor('medium'))
  })

  it('uses the explicit color override in default mode', () => {
    const { group, circle } = makePlantGroup({
      'data-canonical-name': 'Malus domestica',
      'data-color-override': '#C44230',
      'data-stratum': 'medium',
    })
    const plantsLayer = {
      find: () => [group],
      batchDraw: vi.fn(),
    } as any

    updatePlantDisplay(plantsLayer, 'default', null, 8, 8, new Map())

    expect(circle.radius).toHaveBeenLastCalledWith(CIRCLE_SCREEN_PX)
    expect(circle.fill).toHaveBeenLastCalledWith('#C44230')
  })

  it('uses the resolved flower color in flower mode and ignores explicit overrides', () => {
    const { group, circle } = makePlantGroup({
      'data-canonical-name': 'Malus domestica',
      'data-color-override': '#C44230',
      'data-stratum': 'medium',
    })
    const plantsLayer = {
      find: () => [group],
      batchDraw: vi.fn(),
    } as any
    const speciesCache = new Map([
      ['Malus domestica', { resolved_flower_color: 'Yellow' }],
    ])

    updatePlantDisplay(plantsLayer, 'default', 'flower', 8, 8, speciesCache)

    expect(circle.radius).toHaveBeenLastCalledWith(CIRCLE_SCREEN_PX)
    expect(circle.fill).toHaveBeenLastCalledWith('#C8A51E')
  })

  it('falls back to the unknown flower color when no flower data resolves', () => {
    const { group, circle } = makePlantGroup({
      'data-canonical-name': 'Malus domestica',
      'data-stratum': 'medium',
    })
    const plantsLayer = {
      find: () => [group],
      batchDraw: vi.fn(),
    } as any
    const speciesCache = new Map([
      ['Malus domestica', { resolved_flower_color: null }],
    ])

    updatePlantDisplay(plantsLayer, 'default', 'flower', 8, 8, speciesCache)

    expect(circle.fill).toHaveBeenLastCalledWith(UNKNOWN_FLOWER_COLOR)
  })
})
