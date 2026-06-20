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
    strokeWidth?: number
  }
  | {
    kind: 'lines'
    segments: readonly PlantSymbolRecipeSegment[]
    strokeWidth?: number
  }

export type PlantSymbolRecipePoint = readonly [x: number, y: number]
export type PlantSymbolRecipeSegment = readonly [x1: number, y1: number, x2: number, y2: number]

export const DEFAULT_PLANT_SYMBOL_SHAPE_STROKE_WIDTH = 0.14
export const DEFAULT_PLANT_SYMBOL_LINE_STROKE_WIDTH = 0.16

export const PLANT_SYMBOL_RECIPES: Record<PlantSymbolId, readonly PlantSymbolRecipeCommand[]> = {
  round: [
    { kind: 'circle', cx: 0, cy: 0, radius: 1, fill: true, stroke: true },
  ],
  square: [
    { kind: 'rect', x: -0.78, y: -0.78, width: 1.56, height: 1.56, fill: true, stroke: true },
  ],
  triangle: [
    {
      kind: 'path',
      points: [[0, -0.98], [0.93, 0.78], [-0.93, 0.78]],
      closed: true,
      fill: true,
      stroke: true,
    },
  ],
  cross: [
    { kind: 'lines', strokeWidth: 0.24, segments: [[-0.96, 0, 0.96, 0], [0, -0.96, 0, 0.96]] },
  ],
  tree: [
    { kind: 'circle', cx: 0, cy: -0.25, radius: 0.78, fill: true, stroke: true },
    { kind: 'lines', strokeWidth: 0.22, segments: [[0, 0.47, 0, 0.98]] },
  ],
  shrub: [
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
  ],
  herbaceous: [
    {
      kind: 'lines',
      strokeWidth: 0.24,
      segments: [
        [0, 0.95, 0, -0.84],
        [0, 0.15, -0.74, -0.32],
        [0, -0.13, 0.74, -0.57],
      ],
    },
  ],
  climber: [
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
  ],
  groundcover: [
    {
      kind: 'path',
      points: [
        [-0.96, 0.42],
        [-0.72, 0.05],
        [-0.42, 0.28],
        [-0.12, -0.08],
        [0.2, 0.26],
        [0.52, -0.02],
        [0.92, 0.34],
      ],
      closed: false,
      fill: false,
      stroke: true,
      strokeWidth: 0.24,
    },
    { kind: 'lines', strokeWidth: 0.2, segments: [[-0.9, 0.56, 0.9, 0.56]] },
  ],
  wave: [
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
  ],
}
