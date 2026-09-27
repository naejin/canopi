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

/** What a stamp pick places: the tool card names it and counts its plants and species. */
export interface CanvasStampGuidance {
  readonly kind: 'plant' | 'zone' | 'annotation' | 'group'
  /** The plant's name or the group's name; null when the object has none to show. */
  readonly name: string | null
  readonly plants: number
  readonly species: number
}

/** The active tool's state as the tool card explains it. UI mirror state only. */
export interface CanvasToolGuidance {
  /** A gesture is in progress, so Esc cancels it rather than leaving the tool. */
  readonly gesture: boolean
  /** Place a stamp: the object picked to copy, once there is one. */
  readonly stamp: CanvasStampGuidance | null
}

export const IDLE_CANVAS_TOOL_GUIDANCE: CanvasToolGuidance = Object.freeze({ gesture: false, stamp: null })

const toolGuidance = signal<CanvasToolGuidance>(IDLE_CANVAS_TOOL_GUIDANCE)

export function setCanvasToolGuidance(next: CanvasToolGuidance): void {
  const current = toolGuidance.peek()
  if (current.gesture === next.gesture && stampGuidanceEqual(current.stamp, next.stamp)) return
  toolGuidance.value = next
}

function stampGuidanceEqual(a: CanvasStampGuidance | null, b: CanvasStampGuidance | null): boolean {
  if (a === null || b === null) return a === b
  return a.kind === b.kind && a.name === b.name && a.plants === b.plants && a.species === b.species
}

export { toolGuidance as canvasToolGuidanceState }
