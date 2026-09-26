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

/** The place search shortcut (Ctrl+K, or Cmd+K), shared by both editions' shortcut routing; Ctrl+F finds plants. */
export function isPlaceSearchShortcut(event: {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}): boolean {
  return (event.ctrlKey !== event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k'
}
