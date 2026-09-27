import { signal } from '@preact/signals'
import { designSessionStore } from '../document-session/store'
import { selectPanel } from '../shell/state'

/**
 * What a new Calendar action starts with when another surface asks for one
 * (the map's right-click Add to calendar…): the selected plants, or one zone.
 */
export type CalendarAddTarget =
  | { readonly kind: 'selected-plants' }
  | { readonly kind: 'zone'; readonly zoneName: string }

export interface CalendarAddRequest {
  readonly target: CalendarAddTarget
  /** The Design session that asked; a request never crosses into another Design. */
  readonly sessionIdentity: object
}

/** A pending request; the Calendar workbench opens its editor with it and clears it. */
export const calendarAddRequest = signal<CalendarAddRequest | null>(null)

/** Opens the Calendar with a new action's editor aimed at `target`. */
export function requestCalendarAdd(target: CalendarAddTarget): void {
  calendarAddRequest.value = { target, sessionIdentity: designSessionStore.sessionIdentity.peek() }
  selectPanel('calendar')
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    calendarAddRequest.value = null
  })
}
