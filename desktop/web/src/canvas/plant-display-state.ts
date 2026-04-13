import { signal } from '@preact/signals'

export type PlantSizeMode = 'default' | 'canopy'
export type ColorByAttribute =
  | 'stratum'
  | 'hardiness'
  | 'lifecycle'
  | 'nitrogen'
  | 'edibility'
  | 'flower'

// UI mirror state only. SceneCanvasRuntime owns the authoritative session values.
export const plantSizeMode = signal<PlantSizeMode>('default')
export const plantColorByAttr = signal<ColorByAttribute | null>(null)
