import { signal } from '@preact/signals'
import { designSessionStore } from '../document-session/store'
import { selectPanel } from '../shell/state'

export interface BudgetPriceRequest {
  readonly canonicalName: string
  /** The Design session that asked; a request never crosses into another Design. */
  readonly sessionIdentity: object
}

/** A pending Set unit cost… request; the Budget workbench edits that price and clears it. */
export const budgetPriceRequest = signal<BudgetPriceRequest | null>(null)

/** Opens the Budget with the species' unit cost field focused (the map's right-click Set unit cost…). */
export function requestBudgetPrice(canonicalName: string): void {
  budgetPriceRequest.value = { canonicalName, sessionIdentity: designSessionStore.sessionIdentity.peek() }
  selectPanel('budget')
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    budgetPriceRequest.value = null
  })
}
