import { signal, type Signal } from '@preact/signals'
import { designSessionStore } from '../document-session/store'

export type BudgetSort = 'name' | 'highest-total' | 'most-plants'
export type BudgetPriceFilter = 'all' | 'no-price' | 'zero-price'
export type CalendarCompletionFilter = 'open' | 'completed' | 'all'
export type CalendarDisplay = 'month' | 'agenda'

export interface ConsortiumListFilter {
  readonly stratum: string
  readonly phase: number | null
}

export interface PlanningViewState {
  readonly sessionIdentity: object
  readonly budgetSearch: Signal<string>
  readonly budgetSort: Signal<BudgetSort>
  readonly budgetPriceFilter: Signal<BudgetPriceFilter>
  budgetScrollTop: number
  readonly calendarSearch: Signal<string>
  readonly calendarActionType: Signal<string>
  readonly calendarCompletion: Signal<CalendarCompletionFilter>
  readonly calendarMonth: Signal<string>
  readonly calendarSelectedDate: Signal<string | null>
  readonly calendarDisplay: Signal<CalendarDisplay>
  readonly calendarExpanded: Signal<boolean>
  readonly calendarUnscheduledExpanded: Signal<boolean>
  calendarScrollTop: number
  readonly consortiumSearch: Signal<string>
  readonly consortiumFilter: Signal<ConsortiumListFilter | null>
  readonly consortiumExpandedStrata: Signal<ReadonlySet<string>>
  readonly consortiumExpansionInitialized: Signal<boolean>
  consortiumScrollTop: number
}

let owner: PlanningViewState | null = null

export function usePlanningViewState(): PlanningViewState {
  return planningViewStateFor(designSessionStore.sessionIdentity.value)
}

export function readPlanningViewState(): PlanningViewState {
  return planningViewStateFor(designSessionStore.sessionIdentity.peek())
}

export function disposePlanningViewState(): void {
  owner = null
}

function planningViewStateFor(sessionIdentity: object): PlanningViewState {
  if (owner?.sessionIdentity === sessionIdentity) return owner
  owner = createPlanningViewState(sessionIdentity)
  return owner
}

function createPlanningViewState(sessionIdentity: object): PlanningViewState {
  const today = new Date()
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  return {
    sessionIdentity,
    budgetSearch: signal(''),
    budgetSort: signal<BudgetSort>('name'),
    budgetPriceFilter: signal<BudgetPriceFilter>('all'),
    budgetScrollTop: 0,
    calendarSearch: signal(''),
    calendarActionType: signal('all'),
    calendarCompletion: signal<CalendarCompletionFilter>('open'),
    calendarMonth: signal(month),
    calendarSelectedDate: signal<string | null>(null),
    calendarDisplay: signal<CalendarDisplay>('month'),
    calendarExpanded: signal(false),
    calendarUnscheduledExpanded: signal(true),
    calendarScrollTop: 0,
    consortiumSearch: signal(''),
    consortiumFilter: signal<ConsortiumListFilter | null>(null),
    consortiumExpandedStrata: signal<ReadonlySet<string>>(new Set()),
    consortiumExpansionInitialized: signal(false),
    consortiumScrollTop: 0,
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposePlanningViewState)
}
