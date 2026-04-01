import { describe, expect, it, vi } from 'vitest'
import { updatePlantDensity, updatePlantStacking } from '../canvas/plants'
import { ScreenGrid } from '../canvas/runtime/screen-grid'

function createPlantGroup(
  id: string,
  initialPosition: { x: number; y: number },
  options: {
    circleFill?: string
    colorOverride?: string | null
    stratum?: string | null
  } = {},
) {
  let position = initialPosition
  const attrs = new Map<string, unknown>()
  const label = { visible: vi.fn() }
  const circle = { fill: vi.fn(() => options.circleFill ?? '#4CAF50') }
  const nodes = new Map<string, any>([
    ['.plant-label', label],
    ['.plant-circle', circle],
  ])

  attrs.set('data-color-override', options.colorOverride ?? null)
  attrs.set('data-stratum', options.stratum ?? 'low')

  const group = {
    id: () => id,
    getAbsolutePosition: () => position,
    setPosition: (next: { x: number; y: number }) => {
      position = next
    },
    findOne: vi.fn((selector: string) => nodes.get(selector)),
    add: vi.fn((node: any) => {
      const name = typeof node.name === 'function' ? node.name() : ''
      if (name === 'stackBadgeBg') nodes.set('.stackBadgeBg', node)
      if (name === 'stackBadgeText') nodes.set('.stackBadgeText', node)
    }),
    setAttr: vi.fn((name: string, value: unknown) => {
      attrs.set(name, value)
    }),
    getAttr: vi.fn((name: string) => attrs.get(name) ?? null),
  }

  return {
    group: group as any,
    label,
    circle,
  }
}

function rebuildGrid(groups: Array<{ group: any }>): ScreenGrid {
  const grid = new ScreenGrid(40)
  grid.rebuild(groups.map(({ group }) => {
    const pos = group.getAbsolutePosition()
    return { group, sx: pos.x, sy: pos.y }
  }))
  return grid
}

describe('plant density and stacking', () => {
  it('keeps at least one label visible in a dense cluster', () => {
    const plants = [
      createPlantGroup('plant-1', { x: 0, y: 0 }),
      createPlantGroup('plant-2', { x: 10, y: 10 }),
      createPlantGroup('plant-3', { x: 15, y: 15 }),
    ]

    updatePlantDensity(
      plants.map(({ group }) => group),
      'icon+label',
      undefined,
      rebuildGrid(plants),
    )

    const visibility = plants.map(({ label }) => {
      const calls = label.visible.mock.calls
      return calls[calls.length - 1]?.[0]
    })
    expect(visibility.filter((value) => value === true)).toHaveLength(1)
    expect(visibility.filter((value) => value === false)).toHaveLength(2)
  })

  it('keeps selected plants visible even when density suppression would hide them', () => {
    const plants = [
      createPlantGroup('plant-1', { x: 0, y: 0 }),
      createPlantGroup('plant-2', { x: 10, y: 10 }),
    ]

    updatePlantDensity(
      plants.map(({ group }) => group),
      'icon+label',
      new Set(['plant-2']),
      rebuildGrid(plants),
    )

    expect(plants[0]!.label.visible).toHaveBeenLastCalledWith(false)
    expect(plants[1]!.label.visible).toHaveBeenLastCalledWith(true)
  })

  it('allows differently colored neighbors to keep labels when only the relaxed threshold applies', () => {
    const plants = [
      createPlantGroup('plant-1', { x: 0, y: 0 }, { circleFill: '#4CAF50' }),
      createPlantGroup('plant-2', { x: 30, y: 0 }, { circleFill: '#C44230' }),
    ]

    updatePlantDensity(
      plants.map(({ group }) => group),
      'icon+label',
      undefined,
      rebuildGrid(plants),
    )

    expect(plants[0]!.label.visible).toHaveBeenLastCalledWith(true)
    expect(plants[1]!.label.visible).toHaveBeenLastCalledWith(true)
  })

  it('prefers user-colored plants over default-color plants when labels compete', () => {
    const plants = [
      createPlantGroup('default', { x: 0, y: 0 }, { circleFill: '#4CAF50' }),
      createPlantGroup('colored', { x: 10, y: 10 }, { circleFill: '#C44230', colorOverride: '#C44230' }),
    ]

    updatePlantDensity(
      plants.map(({ group }) => group),
      'icon+label',
      undefined,
      rebuildGrid(plants),
    )

    expect(plants[0]!.label.visible).toHaveBeenLastCalledWith(false)
    expect(plants[1]!.label.visible).toHaveBeenLastCalledWith(true)
  })

  it('falls back to override colors when the circle fill cannot be read as a plain string', () => {
    const plants = [
      createPlantGroup('default', { x: 0, y: 0 }, { circleFill: '#4CAF50' }),
      createPlantGroup('override-a', { x: 25, y: 0 }, { circleFill: '#4CAF50', colorOverride: '#C44230' }),
      createPlantGroup('override-b', { x: 50, y: 0 }, { circleFill: '#4CAF50', colorOverride: '#C44230' }),
    ]

    plants[1]!.circle.fill.mockReturnValueOnce({} as any)
    plants[2]!.circle.fill.mockReturnValueOnce({} as any)

    updatePlantDensity(
      plants.map(({ group }) => group),
      'icon+label',
      undefined,
      rebuildGrid(plants),
    )

    expect(plants[0]!.label.visible).toHaveBeenLastCalledWith(true)
    expect(plants[1]!.label.visible).toHaveBeenLastCalledWith(true)
    expect(plants[2]!.label.visible).toHaveBeenLastCalledWith(false)
  })

  it('creates and later hides stack badges as clusters form and disperse', () => {
    const plants = [
      createPlantGroup('plant-1', { x: 0, y: 0 }),
      createPlantGroup('plant-2', { x: 2, y: 2 }),
    ]

    updatePlantStacking(
      plants.map(({ group }) => group),
      rebuildGrid(plants),
    )

    const firstBadge = plants[0]!.group.findOne('.stackBadgeText')
    expect(plants[0]!.group.getAttr('data-stack-count')).toBe(2)
    expect(firstBadge?.text()).toBe('2')

    plants[1]!.group.setPosition({ x: 100, y: 100 })

    updatePlantStacking(
      plants.map(({ group }) => group),
      rebuildGrid(plants),
    )

    expect(plants[0]!.group.getAttr('data-stack-count')).toBe(null)
    expect(plants[0]!.group.findOne('.stackBadgeBg')?.visible()).toBe(false)
    expect(plants[0]!.group.findOne('.stackBadgeText')?.visible()).toBe(false)
  })
})
