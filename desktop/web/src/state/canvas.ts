import { signal } from '@preact/signals'
import type { Guide } from '../canvas/guides'
export { activeTool, canvasReady, selectedObjectIds } from '../canvas/session-state'
export { zoomLevel, zoomReference } from '../canvas/view-state'
export const snapToGridEnabled = signal<boolean>(false)
export const gridVisible = signal<boolean>(true)
export const rulersVisible = signal<boolean>(true)
export const northBearingDeg = signal<number>(0)
export const snapToGuidesEnabled = signal<boolean>(true)
export const guides = signal<Guide[]>([])

// Lock state — nodes in this set cannot be selected or transformed
export const lockedObjectIds = signal<Set<string>>(new Set())

// Canvas entity revision — incremented on every scene mutation (plant/zone/annotation
// changes) so bottom-panel components can subscribe to canvas-store changes. Parallel
// to nonCanvasRevision in state/design.ts which tracks document-store changes.
export const sceneEntityRevision = signal<number>(0)

// Incremented when localized plant names finish loading (async IPC).
// Panels subscribe to this so they re-render with fresh names after
// the label resolver cache is populated for the new locale.
export const plantNamesRevision = signal<number>(0)
