import { computed, signal } from '@preact/signals'
import type { PlantSymbolId } from '../generated/known-canopi-keys'

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

/**
 * Plant a row, as the tool card shows it: which step it is on, the picked
 * plant, the spacing field and how many plants the row would add.
 */
export interface CanvasPlantRowGuidance {
  /** `pick`: click a plant; `missed`: that click found no usable plant; `row`: a plant is picked. */
  readonly phase: 'pick' | 'missed' | 'row'
  /** The picked plant's shown name. */
  readonly plantName: string | null
  /** The picked plant's symbol and colour, for the card's glyph. */
  readonly glyph: { readonly symbol: PlantSymbolId; readonly color: string } | null
  /** The spacing field's text, as typed. */
  readonly interval: string
  readonly intervalValid: boolean
  /** Plants the drawn row would add; null before a row is drawn. */
  readonly count: number | null
  /** `dense` above 100 plants; `blocked` above the most one row may add. */
  readonly density: 'normal' | 'dense' | 'blocked'
  /** Moves each time the spacing field should take focus (a plant picked, an invalid spacing kept). */
  readonly focusRequest: number
}

/** The active tool's state as the tool card explains it. UI mirror state only. */
export interface CanvasToolGuidance {
  /** A gesture is in progress, so Esc cancels it rather than leaving the tool. */
  readonly gesture: boolean
  /** Place a stamp: the object picked to copy, once there is one. */
  readonly stamp: CanvasStampGuidance | null
  /** Place a stamp: the held stamp's angle in degrees (clockwise, `[` and `]` turn it), or null without one. */
  readonly stampRotationDeg: number | null
  /** Place plants: the map was clicked with no species chosen, so the card points to its chooser. */
  readonly promptSpecies: boolean
  /** Plant a row's step and spacing field. */
  readonly plantRow: CanvasPlantRowGuidance | null
}

export const IDLE_CANVAS_TOOL_GUIDANCE: CanvasToolGuidance = Object.freeze({ gesture: false, stamp: null, stampRotationDeg: null, promptSpecies: false, plantRow: null })

const toolGuidance = signal<CanvasToolGuidance>(IDLE_CANVAS_TOOL_GUIDANCE)

export function setCanvasToolGuidance(next: CanvasToolGuidance): void {
  const current = toolGuidance.peek()
  if (
    current.gesture === next.gesture
    && current.promptSpecies === next.promptSpecies
    && current.stampRotationDeg === next.stampRotationDeg
    && stampGuidanceEqual(current.stamp, next.stamp)
    && plantRowGuidanceEqual(current.plantRow, next.plantRow)
  ) return
  toolGuidance.value = next
}

function stampGuidanceEqual(a: CanvasStampGuidance | null, b: CanvasStampGuidance | null): boolean {
  if (a === null || b === null) return a === b
  return a.kind === b.kind && a.name === b.name && a.plants === b.plants && a.species === b.species
}

function plantRowGuidanceEqual(a: CanvasPlantRowGuidance | null, b: CanvasPlantRowGuidance | null): boolean {
  if (a === null || b === null) return a === b
  return a.phase === b.phase && a.plantName === b.plantName && a.interval === b.interval
    && a.glyph?.symbol === b.glyph?.symbol && a.glyph?.color === b.glyph?.color
    && a.intervalValid === b.intervalValid && a.count === b.count && a.density === b.density
    && a.focusRequest === b.focusRequest
}

export { toolGuidance as canvasToolGuidanceState }
