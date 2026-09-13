import { selectPanel, type Panel } from '../src/app/shell/state'

export const GALLERY_SURFACES = {
  workspace: 'Workspace',
  color: 'Plant color',
  symbol: 'Plant symbol',
  key: 'Species key',
  layers: 'Layers',
  calendar: 'Calendar',
  'calendar-expanded': 'Calendar expanded',
  budget: 'Budget',
  consortium: 'Consortium',
  favorites: 'Favorites',
  notebook: 'Design notebook',
  lens: 'Inspection lens',
} as const

export type GallerySurface = keyof typeof GALLERY_SURFACES

export function parseGallerySurface(value: string | null): GallerySurface {
  if (value && value in GALLERY_SURFACES) return value as GallerySurface
  return 'color'
}

export function selectGalleryPanel(surface: GallerySurface): void {
  selectPanel(panelForGallerySurface(surface))
}

function panelForGallerySurface(surface: GallerySurface): Panel {
  switch (surface) {
    case 'key': return 'species-key'
    case 'layers': return 'layers'
    case 'favorites': return 'favorites'
    case 'notebook': return 'design-notebook'
    case 'calendar':
    case 'calendar-expanded': return 'calendar'
    case 'budget': return 'budget'
    case 'consortium': return 'consortium'
    default: return 'canvas'
  }
}
