import { signal } from '@preact/signals'

/** Whether the canvas place search field is open; opened by the pin, the shortcut or the empty-Design prompt. */
export const placeSearchOpen = signal(false)

export function openPlaceSearch(): void {
  placeSearchOpen.value = true
}

export function closePlaceSearch(): void {
  placeSearchOpen.value = false
}

/** Zoom at which a found place is shown: close enough to start designing. */
export const PLACE_SEARCH_ZOOM = 17
