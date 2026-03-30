export type RenderPass =
  | 'counter-scale'
  | 'plant-display'
  | 'lod'
  | 'density'
  | 'stacking'
  | 'annotations'
  | 'theme'
  | 'overlays'

export const DEFAULT_RENDER_PASSES: RenderPass[] = [
  'counter-scale',
  'plant-display',
  'lod',
  'annotations',
  'theme',
  'overlays',
  'density',
  'stacking',
]
