import { computed, signal } from '@preact/signals'

export const activeTool = signal<string>('select')
export const canvasReady = signal<boolean>(false)
export const selectedObjectIds = signal<Set<string>>(new Set())

// UI mirror state only. SceneCanvasRuntime owns authoritative canvas selection.
export function getCanvasTool(): string {
  return activeTool.value
}

export function setCanvasTool(name: string): void {
  activeTool.value = name
}

// Re-export the signal directly — wrapping in computed() adds an extra reactive
// node with no behavioral difference since computed(() => signal.value) === signal.
export { activeTool as canvasToolState }

export function getCanvasSelection(): Set<string> {
  return new Set(selectedObjectIds.value)
}

export function setCanvasSelection(ids: Iterable<string>): void {
  const next = new Set(ids)
  const current = selectedObjectIds.value
  if (next.size === current.size && [...next].every((id) => current.has(id))) return
  selectedObjectIds.value = next
}

export { selectedObjectIds as canvasSelectionState }

export function clearCanvasSelection(): void {
  if (selectedObjectIds.value.size === 0) return
  selectedObjectIds.value = new Set()
}

export function hasCanvasSelection(): boolean {
  return selectedObjectIds.value.size > 0
}

// Derived value — genuinely needs computed() since it maps Set → boolean.
export const canvasHasSelectionState = computed(() => selectedObjectIds.value.size > 0)

export function setCanvasReadyState(ready: boolean): void {
  canvasReady.value = ready
}

export function isCanvasReady(): boolean {
  return canvasReady.value
}

export { canvasReady as canvasReadyState }
