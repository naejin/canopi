import { batch } from '@preact/signals'
import type { Consortium } from '../types/design'
import { highlightedConsortium } from './canvas'
import { mutateCurrentDesign } from './document-mutations'

export function upsertConsortium(next: Consortium): void {
  mutateCurrentDesign((d) => {
    const existing = d.consortiums ?? []
    const consortiums = existing.some((c) => c.id === next.id)
      ? existing.map((c) => (c.id === next.id ? next : c))
      : [...existing, next]
    return { ...d, consortiums }
  })
}

export function deleteConsortium(consortiumId: string): void {
  batch(() => {
    mutateCurrentDesign((d) => ({
      ...d,
      consortiums: (d.consortiums ?? []).filter((c) => c.id !== consortiumId),
    }))
    if (highlightedConsortium.value === consortiumId) {
      highlightedConsortium.value = null
    }
  })
}
