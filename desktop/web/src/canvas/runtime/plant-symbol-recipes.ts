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
    kind: 'curvePath'
    start: PlantSymbolRecipePoint
    segments: readonly PlantSymbolRecipeCurveSegment[]
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
export type PlantSymbolRecipeCurveSegment =
  | {
    kind: 'line'
    to: PlantSymbolRecipePoint
  }
  | {
    kind: 'cubic'
    control1: PlantSymbolRecipePoint
    control2: PlantSymbolRecipePoint
    to: PlantSymbolRecipePoint
  }

export const DEFAULT_PLANT_SYMBOL_SHAPE_STROKE_WIDTH = 0.14
export const DEFAULT_PLANT_SYMBOL_LINE_STROKE_WIDTH = 0.16

const SHRUB_CANOPY_SEGMENTS: readonly PlantSymbolRecipeCurveSegment[] = [
  { kind: 'line', to: [-0.92, 0.2] },
  { kind: 'cubic', control1: [-0.9, -0.08], control2: [-0.62, -0.3], to: [-0.34, -0.22] },
  { kind: 'cubic', control1: [-0.24, -0.52], control2: [0.24, -0.58], to: [0.36, -0.22] },
  { kind: 'cubic', control1: [0.66, -0.3], control2: [0.92, -0.08], to: [0.92, 0.2] },
  { kind: 'line', to: [0.92, 0.56] },
]

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
      kind: 'curvePath',
      start: [-0.92, 0.56],
      segments: SHRUB_CANOPY_SEGMENTS,
      closed: true,
      fill: true,
      stroke: false,
    },
    {
      kind: 'curvePath',
      start: [-0.92, 0.56],
      segments: SHRUB_CANOPY_SEGMENTS,
      closed: false,
      fill: false,
      stroke: true,
      strokeWidth: 0.14,
    },
    { kind: 'lines', strokeWidth: 0.22, segments: [[-0.88, 0.56, 0.88, 0.56]] },
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
