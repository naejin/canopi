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
 * A request, from Layers, to analyze one item in the Data Library, optionally
 * with one registry entry already chosen. The finished results then join the
 * Design that asked.
 */
export const libraryAnalyzeRequest = signal<{ readonly itemId: string; readonly analysisId: string | null } | null>(null)

export function analyzeInLibrary(itemId: string, analysisId: string | null = null): void {
  libraryAnalyzeRequest.value = { itemId, analysisId }
  sidePanel.value = 'data'
}

/**
 * A request, from the Analyze dialog, to show one reference in Layers rather
 * than calculating a result the Design already has.
 */
export const layersFocusRequest = signal<string | null>(null)

export function showInLayers(itemId: string): void {
  layersFocusRequest.value = itemId
  sidePanel.value = 'layers'
}
