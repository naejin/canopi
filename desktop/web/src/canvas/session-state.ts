import { computed, signal } from '@preact/signals'

export const activeTool = signal<string>('select')
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

export function setCanvasSelection(
  ids: Iterable<string>,
  options: { readonly publishIfUnchanged?: boolean } = {},
): void {
  const next = new Set(ids)
  const current = selectedObjectIds.value
  const unchanged = next.size === current.size && [...next].every((id) => current.has(id))
  if (unchanged && !options.publishIfUnchanged) return
  selectedObjectIds.value = next
}

export { selectedObjectIds as canvasSelectionState }

// Derived value — genuinely needs computed() since it maps Set → boolean.
export const canvasHasSelectionState = computed(() => selectedObjectIds.value.size > 0)
