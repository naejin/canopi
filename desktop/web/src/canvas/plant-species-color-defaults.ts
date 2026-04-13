import { signal } from '@preact/signals'

// Read-only mirror for persisted scene/document species color defaults.
// SceneCanvasRuntime owns synchronization from the authoritative scene store.
export const plantSpeciesColorDefaults = signal<Record<string, string>>({})

export function syncPlantSpeciesColorDefaults(colors: Record<string, string>): void {
  plantSpeciesColorDefaults.value = { ...colors }
}
