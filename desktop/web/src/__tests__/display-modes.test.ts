import { describe, expect, it, vi } from 'vitest'
import { updatePlantDisplay } from '../canvas/display-modes'
import { CIRCLE_SCREEN_PX, getStratumColor } from '../canvas/plants'

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
})
