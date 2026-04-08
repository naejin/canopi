import { signal } from '@preact/signals'
import type { Guide } from '../canvas/guides'
import type { PanelTarget } from '../types/design'

export const activeTool = signal<string>('select')
export const zoomLevel = signal<number>(1)
/** The stage scale that represents 100% zoom (set on init to fit ~100m in viewport). */
export const zoomReference = signal<number>(1)
export const canvasReady = signal<boolean>(false)
export const selectedObjectIds = signal<Set<string>>(new Set())

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
export type PlantSizeMode = 'default' | 'canopy'
export type ColorByAttribute = 'stratum' | 'hardiness' | 'lifecycle' | 'nitrogen' | 'edibility' | 'flower'
export const plantSizeMode = signal<PlantSizeMode>('default')
export const plantColorByAttr = signal<ColorByAttribute | null>(null)
export const plantColorMenuOpen = signal<boolean>(false)
export const plantSpeciesColors = signal<Record<string, string>>({})

// Plant stamp tool
export interface PlantStampSpecies {
  canonical_name: string
  common_name: string | null
  stratum: string | null
  width_max_m: number | null
}
export const plantStampSpecies = signal<PlantStampSpecies | null>(null)

// Canvas entity revision — incremented on every scene mutation (plant/zone/annotation
// changes) so bottom-panel components can subscribe to canvas-store changes. Parallel
// to nonCanvasRevision in state/design.ts which tracks document-store changes.
export const sceneEntityRevision = signal<number>(0)

// Incremented when localized plant names finish loading (async IPC).
// Panels subscribe to this so they re-render with fresh names after
// the label resolver cache is populated for the new locale.
export const plantNamesRevision = signal<number>(0)

// Bottom panel
export type BottomPanelTab = 'timeline' | 'budget' | 'consortium'
export const VISIBLE_BOTTOM_PANEL_TABS: BottomPanelTab[] = ['timeline', 'budget', 'consortium']
export const bottomPanelOpen = signal<boolean>(false)
export const bottomPanelTab = signal<BottomPanelTab>('timeline')
export const bottomPanelHeight = signal<number>(200)

// Bottom-panel target hover bridge. The canvas runtime resolves these document
// targets to scene IDs without mutating canvas selection/history.
export const hoveredPanelTargets = signal<readonly PanelTarget[]>([])

// Bottom-panel target selection bridge. This is panel-origin presentation state:
// the canvas runtime resolves it to scene highlights without mutating canvas
// selection, selection labels, dirty state, or history.
export const selectedPanelTargets = signal<readonly PanelTarget[]>([])

// Tracks which bottom-panel tab owns the current panel-origin selection so tab
// cleanup only clears its own selection.
export const selectedPanelTargetOrigin = signal<BottomPanelTab | null>(null)

// Canvas-origin target hover bridge. Bottom-panel components can read this for
// hover-only affordances without mutating panel selection/history.
export const hoveredCanvasTargets = signal<readonly PanelTarget[]>([])
