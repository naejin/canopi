import { signal } from '@preact/signals'
import { sidePanel } from '../shell/state'

/**
 * A request, from another surface, to show one item's details in the Data
 * Library. Layers links here instead of duplicating library management.
 */
export const libraryFocusRequest = signal<string | null>(null)

export function openInDataLibrary(id: string): void {
  libraryFocusRequest.value = id
  sidePanel.value = 'data'
}

export function openDataLibrary(): void {
  sidePanel.value = 'data'
}
