import { effect, untracked } from '@preact/signals'
import { geocodingTransport } from '#geocoding-transport'
import { designSessionStore } from '../document-session/store'
import { createPlaceSearchController, type PlaceSearchController } from './place-search'

export type { PlaceSearchResult } from './place-search'
export { parseCoordinates } from './place-search'

/** The app's one place search, bound to the edition's geocoding transport. */
export const placeSearch: PlaceSearchController = createPlaceSearchController({
  transport: geocodingTransport,
})

/** Forget the place search results; the field's text belongs to the field. */
export function dismissPlaceSearch(): void {
  placeSearch.clear()
}

let disposeActiveSession: (() => void) | null = null

/**
 * A place search belongs to the Design it was opened for: replacing the
 * Design clears its results. Installed once per edition bootstrap.
 */
export function installPlaceSearchSession(): () => void {
  disposeActiveSession?.()
  let identity = designSessionStore.sessionIdentity.peek()
  const stop = effect(() => {
    const next = designSessionStore.sessionIdentity.value
    if (next === identity) return
    identity = next
    untracked(dismissPlaceSearch)
  })
  const dispose = (): void => {
    stop()
    if (disposeActiveSession === dispose) disposeActiveSession = null
  }
  disposeActiveSession = dispose
  return dispose
}

export function disposePlaceSearchSession(): void {
  disposeActiveSession?.()
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposePlaceSearchSession()
    placeSearch.dispose()
  })
}
