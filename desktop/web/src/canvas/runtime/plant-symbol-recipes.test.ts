import { describe, expect, it } from 'vitest'
import {
  PLANT_SYMBOL_RECIPES,
  type PlantSymbolRecipeCommand,
} from './plant-symbol-recipes'

describe('plant symbol recipes', () => {
  it('uses optically balanced glyph artwork inside the unchanged Visual Footprint', () => {
    for (const recipe of Object.values(PLANT_SYMBOL_RECIPES)) {
      expect(recipeBounds(recipe).minX).toBeGreaterThanOrEqual(-0.82)
      expect(recipeBounds(recipe).maxX).toBeLessThanOrEqual(0.82)
      expect(recipeBounds(recipe).minY).toBeGreaterThanOrEqual(-0.82)
      expect(recipeBounds(recipe).maxY).toBeLessThanOrEqual(0.82)
    }
  })

  it('uses the approved minimalist habit vocabulary', () => {
    expect(PLANT_SYMBOL_RECIPES.tree.filter((command) => command.kind === 'circle')).toHaveLength(3)
    expect(PLANT_SYMBOL_RECIPES.shrub.filter((command) => command.kind === 'circle')).toHaveLength(3)
    expect(PLANT_SYMBOL_RECIPES.herbaceous).toEqual([
      {
        kind: 'lines',
        strokeWidth: 0.2,
        segments: [
          [0, 0.74, 0, -0.56],
          [0, 0.06, -0.48, -0.28],
          [0, -0.04, 0.48, -0.36],
          [0, -0.34, -0.25, -0.58],
          [0, -0.34, 0.25, -0.58],
        ],
      },
    ])
    expect(PLANT_SYMBOL_RECIPES.climber.filter((command) => command.kind === 'path')).toHaveLength(2)
  })
})

function recipeBounds(recipe: readonly PlantSymbolRecipeCommand[]) {
  const xs: number[] = []
  const ys: number[] = []

  for (const command of recipe) {
    switch (command.kind) {
      case 'circle':
        xs.push(command.cx - command.radius, command.cx + command.radius)
        ys.push(command.cy - command.radius, command.cy + command.radius)
        break
      case 'rect':
        xs.push(command.x, command.x + command.width)
        ys.push(command.y, command.y + command.height)
        break
      case 'path':
        for (const [x, y] of command.points) {
          xs.push(x)
          ys.push(y)
        }
        break
      case 'lines':
        for (const [x1, y1, x2, y2] of command.segments) {
          xs.push(x1, x2)
          ys.push(y1, y2)
        }
        break
    }
  }

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}
