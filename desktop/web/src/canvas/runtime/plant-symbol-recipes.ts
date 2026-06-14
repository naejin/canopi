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
  }

export type PlantSymbolRecipePoint = readonly [x: number, y: number]
export type PlantSymbolRecipeSegment = readonly [x1: number, y1: number, x2: number, y2: number]

export const PLANT_SYMBOL_RECIPES: Record<PlantSymbolId, readonly PlantSymbolRecipeCommand[]> = {
  round: [
    { kind: 'circle', cx: 0, cy: 0, radius: 1, fill: true, stroke: true },
  ],
  square: [
    { kind: 'rect', x: -0.66, y: -0.66, width: 1.32, height: 1.32, fill: true, stroke: true },
  ],
  triangle: [
    {
      kind: 'path',
      points: [[0, -0.78], [0.72, 0.58], [-0.72, 0.58]],
      closed: true,
      fill: true,
      stroke: true,
    },
  ],
  cross: [
    { kind: 'lines', segments: [[-0.62, 0, 0.62, 0], [0, -0.62, 0, 0.62]] },
  ],
  tree: [
    { kind: 'circle', cx: 0, cy: -0.22, radius: 0.44, fill: true, stroke: true },
    { kind: 'lines', segments: [[0, 0.2, 0, 0.75]] },
  ],
  shrub: [
    { kind: 'circle', cx: -0.36, cy: 0.08, radius: 0.3, fill: true, stroke: true },
    { kind: 'circle', cx: 0, cy: -0.1, radius: 0.3, fill: true, stroke: true },
    { kind: 'circle', cx: 0.36, cy: 0.08, radius: 0.3, fill: true, stroke: true },
  ],
  herbaceous: [
    {
      kind: 'lines',
      segments: [[0, 0.7, 0, -0.65], [0, -0.15, -0.42, -0.36], [0, 0.1, 0.42, -0.12]],
    },
  ],
  climber: [
    {
      kind: 'lines',
      segments: [
        [-0.16, 0.72, 0.22, 0.35],
        [0.22, 0.35, -0.2, 0],
        [-0.2, 0, 0.18, -0.35],
        [0.18, -0.35, -0.12, -0.72],
        [0.18, -0.35, 0.48, -0.5],
        [-0.2, 0, -0.5, -0.12],
      ],
    },
  ],
}
