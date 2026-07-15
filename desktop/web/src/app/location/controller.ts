import type { Location } from '../../types/design'
import {
  clearDesignLocation as clearDesignLocationEdit,
  setDesignLocation as setDesignLocationEdit,
} from '../design-edit'

export function setDesignLocation(next: Location): boolean {
  return setDesignLocationEdit(next)
}

export function clearDesignLocation(): boolean {
  return clearDesignLocationEdit()
}
