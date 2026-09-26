import { effect, untracked } from '@preact/signals'
import { geocodingTransport } from '#geocoding-transport'
import { designSessionStore } from '../document-session/store'
import { createPlaceSearchController, type PlaceSearchController } from './place-search'
import { closePlaceSearch } from './place-search-ui'

export type { PlaceSearchResult } from './place-search'

/** The app's one place search, bound to the edition's geocoding transport. */
export const placeSearch: PlaceSearchController = createPlaceSearchController({
  transport: geocodingTransport,
})

/** Close the place search field and forget its results. */
export function dismissPlaceSearch(): void {
  placeSearch.clear()
  closePlaceSearch()
}

let disposeActiveSession: (() => void) | null = null

/**
 * A place search belongs to the Design it was opened for: replacing the
 * Design closes it. Installed once per edition bootstrap.
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
