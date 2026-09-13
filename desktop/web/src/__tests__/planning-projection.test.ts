import { describe, expect, it } from 'vitest'
import {
  buildBudgetPlanningProjection,
  buildBudgetListProjection,
  buildCalendarPlanningProjection,
  buildConsortiumListProjection,
  buildConsortiumPlanningProjection,
} from '../app/planning-projection'
import { MANUAL_TARGET, speciesBudgetTarget, speciesTarget } from '../target'
import type { BudgetItem, Consortium, PlacedPlant, TimelineAction } from '../types/design'

function makePlant(canonicalName: string, commonName: string | null = null): PlacedPlant {
  return {
    id: `plant-${canonicalName}`,
    canonical_name: canonicalName,
    common_name: commonName,
    color: null,
    position: { x: 0, y: 0 },
    rotation: null,
    scale: null,
    notes: null,
    planted_date: null,
    quantity: 1,
    locked: false,
  }
}

function makeAction(overrides: Partial<TimelineAction> = {}): TimelineAction {
  return {
    id: 'timeline-1',
    action_type: 'planting',
    description: 'Plant apple',
    start_date: '2026-04-10',
    end_date: null,
    recurrence: null,
    targets: [speciesTarget('Malus domestica')],
    depends_on: null,
    completed: false,
    order: 0,
    ...overrides,
  }
}

describe('Planning Projection', () => {
  it('projects Budget rows, price state, and totals from Design plus Placed Plant data', () => {
    const budget: BudgetItem[] = [
      {
        target: speciesBudgetTarget('Malus domestica'),
        category: 'plants',
        description: 'Malus domestica',
        quantity: 0,
        unit_cost: 5,
        currency: 'EUR',
      },
      {
        target: MANUAL_TARGET,
        category: 'materials',
        description: 'Mulch',
        quantity: 1,
        unit_cost: 12,
        currency: 'EUR',
      },
    ]

    const projection = buildBudgetPlanningProjection({
      plants: [
        makePlant('Malus domestica', 'Apple'),
        makePlant('Malus domestica', 'Apple'),
        makePlant('Prunus avium', 'Cherry'),
      ],
      localizedNames: new Map([['Malus domestica', 'Pommier']]),
      budget,
      currency: 'EUR',
      locale: 'fr',
    })

    const apple = projection.rows.find((row) => row.canonical === 'Malus domestica')
    const cherry = projection.rows.find((row) => row.canonical === 'Prunus avium')

    expect(projection.totalPlants).toBe(3)
    expect(projection.pricedCount).toBe(1)
    expect(projection.grandTotal).toBe(10)
    expect(projection.lineItemPriceMap.get('Malus domestica')?.unit_cost).toBe(5)
    expect(apple).toMatchObject({
      commonName: 'Pommier',
      count: 2,
      hasPrice: true,
      subtotal: 10,
    })
    expect(apple?.target).toEqual(speciesBudgetTarget('Malus domestica'))
    expect(cherry).toMatchObject({
      commonName: 'Cherry',
      count: 1,
      hasPrice: false,
      subtotal: 0,
    })
  })

  it('filters and sorts Budget rows without conflating zero and missing prices', () => {
    const projection = buildBudgetPlanningProjection({
      plants: [
        makePlant('Acer campestre', 'Field maple'),
        makePlant('Malus domestica', 'Apple'),
        makePlant('Malus domestica', 'Apple'),
        makePlant('Tilia cordata', 'Lime'),
        makePlant('Tilia cordata', 'Lime'),
        makePlant('Tilia cordata', 'Lime'),
      ],
      localizedNames: new Map([['Acer campestre', 'Érable champêtre']]),
      budget: [
        { target: speciesBudgetTarget('Acer campestre'), category: 'plants', description: '', quantity: 0, unit_cost: 4, currency: 'EUR' },
        { target: speciesBudgetTarget('Malus domestica'), category: 'plants', description: '', quantity: 0, unit_cost: 0, currency: 'EUR' },
      ],
      currency: 'EUR',
      locale: 'fr',
      speciesKey: [
        { canonicalName: 'Acer campestre', commonName: 'Érable champêtre', code: 'ACH', count: 1, appearances: [{ symbol: 'canopy', color: '#A06B1F' }] },
        { canonicalName: 'Malus domestica', commonName: 'Apple', code: 'POM', count: 2, appearances: [] },
        { canonicalName: 'Tilia cordata', commonName: 'Lime', code: 'TCO', count: 3, appearances: [] },
      ],
    })

    expect(buildBudgetListProjection(projection, {
      search: 'erable', sort: 'name', priceFilter: 'all', locale: 'fr',
    }).rows.map((row) => row.canonical)).toEqual(['Acer campestre'])
    expect(buildBudgetListProjection(projection, {
      search: 'pom', sort: 'name', priceFilter: 'all', locale: 'fr',
    }).rows.map((row) => row.canonical)).toEqual(['Malus domestica'])
    expect(buildBudgetListProjection(projection, {
      search: '', sort: 'highest-total', priceFilter: 'all', locale: 'fr',
    }).rows.map((row) => row.canonical)).toEqual(['Acer campestre', 'Malus domestica', 'Tilia cordata'])
    expect(buildBudgetListProjection(projection, {
      search: '', sort: 'name', priceFilter: 'zero-price', locale: 'fr',
    }).rows.map((row) => row.canonical)).toEqual(['Malus domestica'])
    const missing = buildBudgetListProjection(projection, {
      search: '', sort: 'name', priceFilter: 'no-price', locale: 'fr',
    })
    expect(missing.rows.map((row) => row.canonical)).toEqual(['Tilia cordata'])
    expect(missing.shownSubtotal).toBe(0)
    expect(projection.grandTotal).toBe(4)
  })

  it('builds inclusive Consortium matrix counts without stale or duplicate species', () => {
    const consortiums: Consortium[] = [
      { target: speciesTarget('Malus domestica'), stratum: 'high', start_phase: 1, end_phase: 3 },
      { target: speciesTarget('Malus domestica'), stratum: 'high', start_phase: 1, end_phase: 3 },
      { target: speciesTarget('Prunus avium'), stratum: 'mystery', start_phase: 0, end_phase: 6 },
      { target: speciesTarget('Absent species'), stratum: 'emergent', start_phase: 0, end_phase: 6 },
    ]
    const projection = buildConsortiumPlanningProjection({
      consortiums,
      plants: [
        makePlant('Malus domestica', 'Pommier'),
        makePlant('Malus domestica', 'Pommier'),
        makePlant('Prunus avium', 'Cerisier'),
      ],
    })

    expect(projection.activeEntries).toHaveLength(3)
    expect(projection.activeSpeciesCount).toBe(2)
    expect(projection.activePlantCount).toBe(3)
    expect(projection.matrix).toHaveLength(5)
    expect(projection.matrix.find((row) => row.stratum === 'high')?.counts).toEqual([0, 1, 1, 1, 0, 0, 0])
    expect(projection.matrix.find((row) => row.stratum === 'unassigned')?.counts).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(projection.groups.find((group) => group.stratum === 'mystery')).toMatchObject({ supported: false })

    const filtered = buildConsortiumListProjection(projection, {
      search: 'pommier',
      filter: { stratum: 'high', phase: 2 },
    })
    expect(filtered.visibleCount).toBe(1)
    expect(filtered.groups[0]?.rows[0]?.canonicalName).toBe('Malus domestica')
    expect(buildConsortiumListProjection(projection, {
      search: 'cerisier',
      filter: { stratum: 'high', phase: 2 },
    }).visibleCount).toBe(0)
  })

  it('projects Calendar ranges, clipped agenda entries, malformed dates, and filters safely', () => {
    const projection = buildCalendarPlanningProjection({
      actions: [
        makeAction({ id: 'range', description: 'Taille du pommier', start_date: '2026-03-30', end_date: '2026-04-02' }),
        makeAction({ id: 'end-only', start_date: null, end_date: '2026-04-20' }),
        makeAction({ id: 'bad-start', start_date: 'not-a-date', end_date: null }),
        makeAction({ id: 'reversed', start_date: '2026-04-15', end_date: '2026-04-12' }),
        makeAction({ id: 'done', start_date: '2026-04-10', completed: true }),
      ],
      plants: [makePlant('Malus domestica', 'Apple')],
      localizedNames: new Map([['Malus domestica', 'Pommier']]),
      month: '2026-04-01',
      search: 'pommier',
      actionType: 'all',
      completion: 'open',
      locale: 'fr',
    })

    expect(projection.filteredCount).toBe(4)
    expect(projection.agenda.map((group) => group.dateKey)).toEqual(['2026-04-01', '2026-04-15'])
    expect(projection.unscheduled.map((action) => action.id)).toEqual(['bad-start', 'end-only'])
    expect(projection.unscheduled.find((action) => action.id === 'bad-start')?.invalidStart).toBe(true)
    expect(projection.weeks.flat().find((day) => day.dateKey === '2026-04-02')?.actions.map((action) => action.id)).toContain('range')
    expect(projection.weeks.flat().find((day) => day.dateKey === '2026-04-03')?.actions.map((action) => action.id)).not.toContain('range')
    expect(projection.weeks.flat().find((day) => day.dateKey === '2026-04-15')?.actions.map((action) => action.id)).toContain('reversed')
  })

  it('keeps unavailable saved Calendar targets visible in the projection', () => {
    const projection = buildCalendarPlanningProjection({
      actions: [makeAction({
        targets: [speciesTarget('Missing species'), { kind: 'zone', zone_name: 'Missing zone' }],
      })],
      plants: [],
      zoneNames: [],
      month: '2026-04-01',
      search: '',
      actionType: 'all',
      completion: 'all',
      locale: 'en',
    })

    expect(projection.agenda[0]?.actions[0]?.targetLabels).toEqual([
      expect.objectContaining({ label: 'Missing species', unavailable: true }),
      expect.objectContaining({ label: 'Missing zone', unavailable: true }),
    ])
  })

})
