import { signal } from '@preact/signals'

/**
 * The Layers row whose settings show under it (U49 Q7): one row at a time,
 * none at start. Clicking an open row's name closes it. Session view state,
 * never Design data.
 */
export const openLayerRow = signal<string | null>(null)

export function toggleLayerRow(id: string): void {
  openLayerRow.value = openLayerRow.value === id ? null : id
}
