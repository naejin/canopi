import { computed, effect, signal } from '@preact/signals'
import { designSessionStore } from '../document-session/store'
import { currentCanvasQuerySurface } from '../../canvas/session'

/**
 * New-Design guidance, per Design session: "Where is your site?" while an
 * empty Draft has not been placed, then a "Start your Design" card and a
 * chip naming the place that was found. Nothing here is Design state.
 *
 * The question is settled once per session: locate, Skip or the first object
 * closes it, so a Design emptied later (select all, Delete) keeps its tool
 * rail and Undo. Only "Search again" asks it again.
 */
interface SiteOnboardingSession {
  readonly identity: object
  readonly locateDone: boolean
  /** "Search again" asked for the site search, whatever the Design holds. */
  readonly locateRequested: boolean
  readonly startCardOpen: boolean
  /** What the chip shows: the chosen place, or null after Skip. */
  readonly placeLabel: string | null
}

const session = signal<SiteOnboardingSession | null>(null)

function currentSession(): SiteOnboardingSession | null {
  const value = session.value
  return value && value.identity === designSessionStore.sessionIdentity.value ? value : null
}

function update(next: Omit<SiteOnboardingSession, 'identity'>): void {
  session.value = { identity: designSessionStore.sessionIdentity.peek(), ...next }
}

/** An empty Draft (never saved to a file) whose site is not settled yet. */
export const siteLocateOpen = computed(() => {
  const queries = currentCanvasQuerySurface.value
  if (designSessionStore.currentDesign.value === null || !queries) return false
  const current = currentSession()
  if (current?.locateRequested) return true
  if (designSessionStore.designPath.value !== null || current?.locateDone) return false
  void queries.revision.scene.value
  return !queries.sceneHasObjects()
})

// The first object settles the question for a session that has no answer yet
// (every record is an answer or a "Search again"). A computed may not write.
const disposeFirstObjectLatch = effect(() => {
  const queries = currentCanvasQuerySurface.value
  if (!queries || currentSession()) return
  void queries.revision.scene.value
  if (!queries.sceneHasObjects()) return
  update({ locateDone: true, locateRequested: false, startCardOpen: false, placeLabel: null })
})

if (import.meta.hot) import.meta.hot.dispose(disposeFirstObjectLatch)

export const startDesignCardOpen = computed(() => currentSession()?.startCardOpen ?? false)

export const foundSiteLabel = computed(() => {
  const current = currentSession()
  return current?.startCardOpen ? current.placeLabel : null
})

/** The site was chosen (label) or skipped (null): show the Start card. */
export function finishSiteLocate(placeLabel: string | null): void {
  update({ locateDone: true, locateRequested: false, startCardOpen: true, placeLabel })
}

export function closeStartDesignCard(): void {
  const current = currentSession()
  update({ locateDone: true, locateRequested: false, startCardOpen: false, placeLabel: current?.placeLabel ?? null })
}

/** "Search again" on the found-place chip reopens the site search. */
export function searchSiteAgain(): void {
  update({ locateDone: false, locateRequested: true, startCardOpen: false, placeLabel: null })
}
