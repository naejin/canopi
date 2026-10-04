import { signal } from '@preact/signals'

/**
 * View › Search a place… (Ctrl K) focuses the title-bar place field. Each
 * request bumps the counter the field watches, so repeating the command
 * focuses it again.
 */
export const placeSearchFocusRequest = signal(0)

export function requestPlaceSearchFocus(): void {
  placeSearchFocusRequest.value += 1
}

/** Zoom at which a found place is shown: close enough to start designing. */
export const PLACE_SEARCH_ZOOM = 17
