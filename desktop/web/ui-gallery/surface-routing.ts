import { selectPanel, type Panel } from '../src/app/shell/state'

export const GALLERY_SURFACES = {
  workspace: 'Workspace',
  start: 'Start',
  color: 'Plant color',
  symbol: 'Plant symbol',
  'menu-plant': 'Menu · plants',
  'menu-mixed': 'Menu · mixed',
  'menu-empty': 'Menu · empty map',
  symbols: 'Symbol sheet',
  key: 'Species key',
  layers: 'Layers',
  'site-data': 'Site data',
  library: 'Data library',
  import: 'Import data',
  analyze: 'Analyze',
  calendar: 'Calendar',
  'calendar-expanded': 'Calendar expanded',
  budget: 'Budget',
  consortium: 'Consortium',
  stories: 'Stories',
  favorites: 'Favorites',
  notebook: 'Design notebook',
  lens: 'Inspection lens',
  snapshots: 'View snapshots',
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
    case 'site-data': return 'site-data'
    case 'layers':
    case 'library':
    case 'import':
    case 'analyze': return 'layers'
    case 'favorites': return 'favorites'
    case 'notebook': return 'design-notebook'
    case 'calendar':
    case 'calendar-expanded': return 'calendar'
    case 'budget': return 'budget'
    case 'consortium': return 'consortium'
    case 'stories': return 'stories'
    default: return 'canvas'
  }
}
