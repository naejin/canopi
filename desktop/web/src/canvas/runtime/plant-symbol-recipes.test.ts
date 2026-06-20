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

  it('uses the approved built-in Plant Symbol recipes', () => {
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
        kind: 'curvePath',
        start: [-0.92, 0.56],
        segments: [
          { kind: 'line', to: [-0.92, 0.2] },
          { kind: 'cubic', control1: [-0.9, -0.08], control2: [-0.62, -0.3], to: [-0.34, -0.22] },
          { kind: 'cubic', control1: [-0.24, -0.52], control2: [0.24, -0.58], to: [0.36, -0.22] },
          { kind: 'cubic', control1: [0.66, -0.3], control2: [0.92, -0.08], to: [0.92, 0.2] },
          { kind: 'line', to: [0.92, 0.56] },
        ],
        closed: true,
        fill: true,
        stroke: false,
      },
      {
        kind: 'curvePath',
        start: [-0.92, 0.56],
        segments: [
          { kind: 'line', to: [-0.92, 0.2] },
          { kind: 'cubic', control1: [-0.9, -0.08], control2: [-0.62, -0.3], to: [-0.34, -0.22] },
          { kind: 'cubic', control1: [-0.24, -0.52], control2: [0.24, -0.58], to: [0.36, -0.22] },
          { kind: 'cubic', control1: [0.66, -0.3], control2: [0.92, -0.08], to: [0.92, 0.2] },
          { kind: 'line', to: [0.92, 0.56] },
        ],
        closed: false,
        fill: false,
        stroke: true,
        strokeWidth: 0.14,
      },
      { kind: 'lines', strokeWidth: 0.22, segments: [[-0.88, 0.56, 0.88, 0.56]] },
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
    expect(PLANT_SYMBOL_RECIPES.groundcover).toEqual([
      {
        kind: 'curvePath',
        start: [0, 0.72],
        segments: [
          { kind: 'cubic', control1: [-0.18, 0.5], control2: [-0.48, 0.34], to: [-0.9, 0.28] },
        ],
        closed: false,
        fill: false,
        stroke: true,
        strokeWidth: 0.24,
      },
      {
        kind: 'curvePath',
        start: [0, 0.72],
        segments: [
          { kind: 'cubic', control1: [0.02, 0.46], control2: [0.08, 0.2], to: [0.2, 0] },
        ],
        closed: false,
        fill: false,
        stroke: true,
        strokeWidth: 0.24,
      },
      {
        kind: 'curvePath',
        start: [0, 0.72],
        segments: [
          { kind: 'cubic', control1: [0.2, 0.5], control2: [0.52, 0.34], to: [0.92, 0.26] },
        ],
        closed: false,
        fill: false,
        stroke: true,
        strokeWidth: 0.24,
      },
    ])
    expect(PLANT_SYMBOL_RECIPES.wave).toEqual([
      {
        kind: 'path',
        points: [
          [-0.92, 0.12],
          [-0.7, -0.08],
          [-0.48, -0.22],
          [-0.23, -0.16],
          [0.02, 0.02],
          [0.27, 0.18],
          [0.52, 0.14],
          [0.74, -0.02],
          [0.92, -0.18],
        ],
        closed: false,
        fill: false,
        stroke: true,
        strokeWidth: 0.26,
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
      case 'curvePath':
        xs.push(command.start[0])
        ys.push(command.start[1])
        for (const segment of command.segments) {
          if (segment.kind === 'cubic') {
            xs.push(segment.control1[0], segment.control2[0])
            ys.push(segment.control1[1], segment.control2[1])
          }
          xs.push(segment.to[0])
          ys.push(segment.to[1])
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
