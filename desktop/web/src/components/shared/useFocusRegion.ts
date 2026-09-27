import type { RefObject } from 'preact'
import { useLayoutEffect } from 'preact/hooks'
import { registerFocusRegion, type FocusRegionId } from '../../app/shell/focus-regions'

/** Registers a workspace keyboard region that F6 and Shift F6 move between. */
export function useFocusRegion(ref: RefObject<HTMLElement>, id: FocusRegionId): void {
  useLayoutEffect(() => {
    const element = ref.current
    return element ? registerFocusRegion(id, element) : undefined
  }, [ref, id])
}
