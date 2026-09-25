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

/**
 * A request, from Layers, to calculate slope from one source in the Data
 * Library. The finished result then joins the Design that asked.
 */
export const libraryCalculateRequest = signal<string | null>(null)

export function calculateSlopeInLibrary(id: string): void {
  libraryCalculateRequest.value = id
  sidePanel.value = 'data'
}
