import { signal } from '@preact/signals'

export const activeTool = signal<string>('select')
export const zoomLevel = signal<number>(1)
export const canvasReady = signal<boolean>(false)
export const selectedObjectIds = signal<Set<string>>(new Set())

// Layer visibility: all 7 layers defined.
// water/contours/climate are off by default (empty until Phase 3).
export const layerVisibility = signal<Record<string, boolean>>({
  base: true,
  contours: false,
  climate: false,
  zones: true,
  water: false,
  plants: true,
  annotations: true,
})

// Grid / overlay state
export const gridSize = signal<number>(1)            // meters: 0.5, 1, 2, 5
export const snapToGridEnabled = signal<boolean>(false)
export const gridVisible = signal<boolean>(true)
export const rulersVisible = signal<boolean>(true)
export const northBearingDeg = signal<number>(0)

// Lock state — nodes in this set cannot be selected or transformed
export const lockedObjectIds = signal<Set<string>>(new Set())

// Layer panel sidebar
export const layerPanelOpen = signal<boolean>(true)
export const activeLayerName = signal<string>('zones')

// Per-layer lock state (independent of object-level locks)
export const layerLockState = signal<Record<string, boolean>>({
  base: false,
  contours: false,
  climate: false,
  zones: false,
  water: false,
  plants: false,
  annotations: false,
})

// Per-layer opacity (0.0 – 1.0)
export const layerOpacity = signal<Record<string, number>>({
  base: 1,
  contours: 1,
  climate: 1,
  zones: 1,
  water: 1,
  plants: 1,
  annotations: 1,
})

// Bottom panel
export const bottomPanelOpen = signal<boolean>(false)
export const bottomPanelTab = signal<'timeline' | 'consortium' | 'budget'>('timeline')
export const bottomPanelHeight = signal<number>(200)
