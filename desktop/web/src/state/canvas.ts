import { signal } from '@preact/signals'
import type { Guide } from '../canvas/guides'
import type { Consortium } from '../types/design'

export const activeTool = signal<string>('select')
export const zoomLevel = signal<number>(1)
/** The stage scale that represents 100% zoom (set on init to fit ~100m in viewport). */
export const zoomReference = signal<number>(1)
export const canvasReady = signal<boolean>(false)
export const selectedObjectIds = signal<Set<string>>(new Set())

// Layer visibility: all 7 layers defined.
// water/contours/climate are off by default (empty until Phase 3).
export function createDefaultLayerVisibility(): Record<string, boolean> {
  return {
    base: true,
    contours: false,
    climate: false,
    zones: true,
    water: false,
    plants: true,
    annotations: true,
  }
}

export const layerVisibility = signal<Record<string, boolean>>(createDefaultLayerVisibility())

// Grid / overlay state
export const gridSize = signal<number>(1)            // meters: 0.5, 1, 2, 5
export const snapToGridEnabled = signal<boolean>(false)
export const gridVisible = signal<boolean>(true)
export const rulersVisible = signal<boolean>(true)
export const northBearingDeg = signal<number>(0)
export const snapToGuidesEnabled = signal<boolean>(true)
export const guides = signal<Guide[]>([])

// Lock state — nodes in this set cannot be selected or transformed
export const lockedObjectIds = signal<Set<string>>(new Set())

// Layer panel sidebar
export const layerPanelOpen = signal<boolean>(true)
export const activeLayerName = signal<string>('zones')

// Per-layer lock state (independent of object-level locks)
export function createDefaultLayerLockState(): Record<string, boolean> {
  return {
    base: false,
    contours: false,
    climate: false,
    zones: false,
    water: false,
    plants: false,
    annotations: false,
  }
}

export const layerLockState = signal<Record<string, boolean>>(createDefaultLayerLockState())

// Per-layer opacity (0.0 – 1.0)
export function createDefaultLayerOpacity(): Record<string, number> {
  return {
    base: 1,
    contours: 1,
    climate: 1,
    zones: 1,
    water: 1,
    plants: 1,
    annotations: 1,
  }
}

export const layerOpacity = signal<Record<string, number>>(createDefaultLayerOpacity())

// Plant display modes
export type PlantDisplayMode = 'default' | 'canopy' | 'color-by'
export type ColorByAttribute = 'stratum' | 'hardiness' | 'lifecycle' | 'nitrogen' | 'edibility'
export const plantDisplayMode = signal<PlantDisplayMode>('default')
export const plantColorByAttr = signal<ColorByAttribute>('stratum')

// Plant stamp tool
export interface PlantStampSpecies {
  canonical_name: string
  common_name: string | null
  stratum: string | null
  width_max_m: number | null
}
export const plantStampSpecies = signal<PlantStampSpecies | null>(null)

// Design location — mirror of currentDesign.location for canvas modules
// (avoids circular import from state/design.ts)
export const designLocation = signal<{ lat: number; lon: number } | null>(null)

// Consortium — mirror of currentDesign.consortiums for canvas modules
export const currentConsortiums = signal<Consortium[]>([])
export const highlightedConsortium = signal<string | null>(null)

// Bottom panel
export type BottomPanelTab = 'location' | 'timeline' | 'budget' | 'consortium'
export const BOTTOM_PANEL_TABS: BottomPanelTab[] = ['location', 'timeline', 'budget', 'consortium']
export const VISIBLE_BOTTOM_PANEL_TABS: BottomPanelTab[] = ['location']
export const bottomPanelOpen = signal<boolean>(false)
export const bottomPanelTab = signal<BottomPanelTab>('location')
export const bottomPanelHeight = signal<number>(240)
