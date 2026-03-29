import { batch } from '@preact/signals'
import type { Consortium } from '../types/design'
import {
  currentConsortiums,
  highlightedConsortium,
} from './canvas'
import { currentDesign, nonCanvasRevision } from './design'

export function upsertConsortium(next: Consortium): void {
  const design = currentDesign.value
  if (!design) return

  const consortiums = design.consortiums.some((consortium) => consortium.id === next.id)
    ? design.consortiums.map((consortium) => (consortium.id === next.id ? next : consortium))
    : [...design.consortiums, next]

  batch(() => {
    currentDesign.value = {
      ...design,
      consortiums,
    }
    currentConsortiums.value = consortiums
    nonCanvasRevision.value += 1
  })
}

export function deleteConsortium(consortiumId: string): void {
  const design = currentDesign.value
  if (!design) return

  const consortiums = design.consortiums.filter((consortium) => consortium.id !== consortiumId)

  batch(() => {
    currentDesign.value = {
      ...design,
      consortiums,
    }
    currentConsortiums.value = consortiums
    if (highlightedConsortium.value === consortiumId) {
      highlightedConsortium.value = null
    }
    nonCanvasRevision.value += 1
  })
}
