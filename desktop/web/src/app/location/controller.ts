import type { Location } from '../../types/design'
import { mutateCurrentDesign } from '../document/controller'

export function setDesignLocation(next: Location): void {
  mutateCurrentDesign((design) => ({
    ...design,
    location: next,
  }))
}

export function clearDesignLocation(): void {
  mutateCurrentDesign((design) => ({
    ...design,
    location: null,
  }))
}
