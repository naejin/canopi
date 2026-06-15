import type { PlantSymbolId } from './scene'

export type PlantSymbolRecipeCommand =
  | {
    kind: 'circle'
    cx: number
    cy: number
    radius: number
    fill: boolean
    stroke: boolean
  }
  | {
    kind: 'rect'
    x: number
    y: number
    width: number
    height: number
    fill: boolean
    stroke: boolean
  }
  | {
    kind: 'path'
    points: readonly PlantSymbolRecipePoint[]
    closed: boolean
    fill: boolean
    stroke: boolean
  }
  | {
    kind: 'lines'
    segments: readonly PlantSymbolRecipeSegment[]
    strokeWidth?: number
  }

export type PlantSymbolRecipePoint = readonly [x: number, y: number]
export type PlantSymbolRecipeSegment = readonly [x1: number, y1: number, x2: number, y2: number]

export const DEFAULT_PLANT_SYMBOL_LINE_STROKE_WIDTH = 0.16

export const PLANT_SYMBOL_RECIPES: Record<PlantSymbolId, readonly PlantSymbolRecipeCommand[]> = {
  round: [
    { kind: 'circle', cx: 0, cy: 0, radius: 0.78, fill: true, stroke: true },
  ],
  square: [
    { kind: 'rect', x: -0.61, y: -0.61, width: 1.22, height: 1.22, fill: true, stroke: true },
  ],
  triangle: [
    {
      kind: 'path',
      points: [[0, -0.76], [0.7, 0.58], [-0.7, 0.58]],
      closed: true,
      fill: true,
      stroke: true,
    },
  ],
  cross: [
    { kind: 'lines', strokeWidth: 0.2, segments: [[-0.64, 0, 0.64, 0], [0, -0.64, 0, 0.64]] },
  ],
  tree: [
    { kind: 'circle', cx: 0, cy: -0.36, radius: 0.43, fill: true, stroke: true },
    { kind: 'circle', cx: -0.28, cy: -0.24, radius: 0.28, fill: true, stroke: true },
    { kind: 'circle', cx: 0.28, cy: -0.24, radius: 0.28, fill: true, stroke: true },
    {
      kind: 'lines',
      strokeWidth: 0.17,
      segments: [[0, 0.08, 0, 0.74], [-0.2, 0.36, 0.2, 0.36]],
    },
  ],
  shrub: [
    { kind: 'circle', cx: -0.38, cy: 0.12, radius: 0.32, fill: true, stroke: true },
    { kind: 'circle', cx: 0, cy: -0.04, radius: 0.35, fill: true, stroke: true },
    { kind: 'circle', cx: 0.38, cy: 0.12, radius: 0.32, fill: true, stroke: true },
    {
      kind: 'lines',
      strokeWidth: 0.17,
      segments: [[-0.53, 0.5, 0.53, 0.5], [-0.28, 0.5, -0.1, 0.3], [0.28, 0.5, 0.1, 0.3]],
    },
  ],
  herbaceous: [
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
  ],
  climber: [
    {
      kind: 'lines',
      strokeWidth: 0.18,
      segments: [
        [-0.2, 0.72, 0.1, 0.42],
        [0.1, 0.42, -0.12, 0.12],
        [-0.12, 0.12, 0.12, -0.18],
        [0.12, -0.18, -0.05, -0.68],
      ],
    },
    {
      kind: 'path',
      points: [[0.14, 0.36], [0.54, 0.22], [0.3, 0.04]],
      closed: true,
      fill: true,
      stroke: true,
    },
    {
      kind: 'path',
      points: [[-0.16, 0.06], [-0.54, -0.12], [-0.28, -0.3]],
      closed: true,
      fill: true,
      stroke: true,
    },
  ],
}
