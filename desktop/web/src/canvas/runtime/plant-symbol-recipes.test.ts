import { describe, expect, it } from 'vitest'
import {
  PLANT_SYMBOL_RECIPES,
  type PlantSymbolRecipeCommand,
} from './plant-symbol-recipes'

describe('plant symbol recipes', () => {
  it('keeps optically balanced glyph artwork tied to the unchanged Visual Footprint', () => {
    const approvedOpticalLimit = 1.03
    for (const recipe of Object.values(PLANT_SYMBOL_RECIPES)) {
      expect(recipeBounds(recipe).minX).toBeGreaterThanOrEqual(-approvedOpticalLimit)
      expect(recipeBounds(recipe).maxX).toBeLessThanOrEqual(approvedOpticalLimit)
      expect(recipeBounds(recipe).minY).toBeGreaterThanOrEqual(-approvedOpticalLimit)
      expect(recipeBounds(recipe).maxY).toBeLessThanOrEqual(approvedOpticalLimit)
    }
  })

  it('uses the approved updated Option A proportions', () => {
    expect(PLANT_SYMBOL_RECIPES.round).toEqual([
      { kind: 'circle', cx: 0, cy: 0, radius: 1, fill: true, stroke: true },
    ])
    expect(PLANT_SYMBOL_RECIPES.square).toEqual([
      { kind: 'rect', x: -0.78, y: -0.78, width: 1.56, height: 1.56, fill: true, stroke: true },
    ])
    expect(PLANT_SYMBOL_RECIPES.triangle).toEqual([
      {
        kind: 'path',
        points: [[0, -0.98], [0.93, 0.78], [-0.93, 0.78]],
        closed: true,
        fill: true,
        stroke: true,
      },
    ])
    expect(PLANT_SYMBOL_RECIPES.cross).toEqual([
      {
        kind: 'lines',
        strokeWidth: 0.24,
        segments: [[-0.96, 0, 0.96, 0], [0, -0.96, 0, 0.96]],
      },
    ])
    expect(PLANT_SYMBOL_RECIPES.tree).toEqual([
      { kind: 'circle', cx: 0, cy: -0.25, radius: 0.78, fill: true, stroke: true },
      { kind: 'lines', strokeWidth: 0.22, segments: [[0, 0.47, 0, 0.98]] },
    ])
    expect(PLANT_SYMBOL_RECIPES.shrub).toEqual([
      {
        kind: 'path',
        points: [
          [-0.94, 0.54],
          [-0.74, -0.13],
          [-0.28, -0.5],
          [0.28, -0.5],
          [0.74, -0.13],
          [0.94, 0.54],
        ],
        closed: false,
        fill: false,
        stroke: true,
        strokeWidth: 0.24,
      },
      { kind: 'lines', strokeWidth: 0.22, segments: [[-0.86, 0.56, 0.86, 0.56]] },
    ])
    expect(PLANT_SYMBOL_RECIPES.herbaceous).toEqual([
      {
        kind: 'lines',
        strokeWidth: 0.24,
        segments: [
          [0, 0.95, 0, -0.84],
          [0, 0.15, -0.74, -0.32],
          [0, -0.13, 0.74, -0.57],
        ],
      },
    ])
    expect(PLANT_SYMBOL_RECIPES.climber).toEqual([
      {
        kind: 'lines',
        strokeWidth: 0.24,
        segments: [
          [-0.36, 0.88, 0.25, 0.35],
          [0.25, 0.35, -0.22, -0.14],
          [-0.22, -0.14, 0.27, -0.63],
          [0.27, -0.63, -0.04, -0.9],
        ],
      },
    ])
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
