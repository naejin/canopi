import type { Location } from '../types/design'
import { mutateCurrentDesign } from './document-mutations'

export function setDesignLocation(next: Location): void {
  mutateCurrentDesign((d) => ({
    ...d,
    location: next,
  }))
}

export function clearDesignLocation(): void {
  mutateCurrentDesign((d) => ({
    ...d,
    location: null,
  }))
}
