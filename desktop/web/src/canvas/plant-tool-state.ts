import { signal } from '@preact/signals'

export interface PlantStampSpecies {
  canonical_name: string
  common_name: string | null
  stratum: string | null
  width_max_m: number | null
}

// Tool-scoped UI state only. The stamp target is chosen outside the scene store.
export const plantStampSpecies = signal<PlantStampSpecies | null>(null)
