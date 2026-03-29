import { batch } from '@preact/signals'
import type { Location } from '../types/design'
import { designLocation } from './canvas'
import { currentDesign, nonCanvasRevision } from './design'

export function setDesignLocation(next: Location): void {
  const design = currentDesign.value
  if (!design) return

  batch(() => {
    currentDesign.value = {
      ...design,
      location: next,
    }
    designLocation.value = {
      lat: next.lat,
      lon: next.lon,
    }
    nonCanvasRevision.value += 1
  })
}

export function clearDesignLocation(): void {
  const design = currentDesign.value
  if (!design) return

  batch(() => {
    currentDesign.value = {
      ...design,
      location: null,
    }
    designLocation.value = null
    nonCanvasRevision.value += 1
  })
}
