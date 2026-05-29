import { afterEach, describe, expect, it } from 'vitest'
import {
  buildBudgetPlanningProjection,
  buildConsortiumPlanningProjection,
  buildTimelinePlanningProjection,
  clearPlanningHoveredTargets,
  getPlanningCanvasHoveredSpeciesCanonical,
  planningTargetsSelected,
  prunePlanningSelectionForOrigin,
  readPlanningSelection,
  setPlanningHoveredSpecies,
  setPlanningSelectedTargets,
} from '../app/planning-projection'
import {
  hoveredCanvasTargets,
  hoveredPanelTargets,
  selectedPanelTargetOrigin,
  selectedPanelTargets,
} from '../app/panel-targets/state'
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
  afterEach(() => {
    hoveredCanvasTargets.value = []
    hoveredPanelTargets.value = []
    selectedPanelTargetOrigin.value = null
    selectedPanelTargets.value = []
  })

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

  it('keeps Target presentation state behind the Planning Projection interface', () => {
    setPlanningSelectedTargets('budget', [speciesBudgetTarget('Malus domestica')])

    const budgetSelection = readPlanningSelection('budget')
    const timelineSelection = readPlanningSelection('timeline')

    expect(planningTargetsSelected(budgetSelection, [speciesBudgetTarget('Malus domestica')])).toBe(true)
    expect(planningTargetsSelected(timelineSelection, [speciesBudgetTarget('Malus domestica')])).toBe(false)

    prunePlanningSelectionForOrigin('timeline', [])
    expect(selectedPanelTargets.value).toEqual([speciesBudgetTarget('Malus domestica')])
    expect(selectedPanelTargetOrigin.value).toBe('budget')

    prunePlanningSelectionForOrigin('budget', [[speciesBudgetTarget('Prunus avium')]])
    expect(selectedPanelTargets.value).toEqual([])
    expect(selectedPanelTargetOrigin.value).toBeNull()
  })

  it('bridges canvas-origin and panel-origin species hover through Target values', () => {
    hoveredCanvasTargets.value = [MANUAL_TARGET, speciesTarget('Acer campestre')]

    expect(getPlanningCanvasHoveredSpeciesCanonical()).toBe('Acer campestre')

    setPlanningHoveredSpecies('Malus domestica')
    expect(hoveredPanelTargets.value).toEqual([speciesTarget('Malus domestica')])

    clearPlanningHoveredTargets()
    expect(hoveredPanelTargets.value).toEqual([])
  })

  it('projects active Consortium bars from consortium entries plus Placed Plant data', () => {
    const consortiums: Consortium[] = [
      { target: speciesTarget('Malus domestica'), stratum: 'high', start_phase: 0, end_phase: 2 },
      { target: speciesTarget('Acer campestre'), stratum: 'medium', start_phase: 1, end_phase: 3 },
    ]

    const projection = buildConsortiumPlanningProjection({
      consortiums,
      plants: [makePlant('Malus domestica', 'Apple')],
      speciesColors: { 'Malus domestica': '#a06b1f' },
      localizedNames: new Map([['Malus domestica', 'Pommier']]),
    })

    expect(projection.activeEntries).toEqual([consortiums[0]])
    expect(projection.bars).toHaveLength(1)
    expect(projection.bars[0]).toMatchObject({
      canonicalName: 'Malus domestica',
      commonName: 'Pommier',
      count: 1,
      color: '#a06b1f',
    })
  })

  it('projects Timeline rows, layout, target data, species options, and origin', () => {
    const projection = buildTimelinePlanningProjection({
      actions: [
        makeAction({
          id: 'plant-apple',
          action_type: 'planting',
          start_date: '2026-04-10',
          end_date: '2026-04-20',
        }),
        makeAction({
          id: 'harvest-apple',
          action_type: 'harvest',
          description: 'Pick apple',
          start_date: '2026-08-10',
          targets: [MANUAL_TARGET],
        }),
        makeAction({
          id: 'unknown-type',
          action_type: 'inspect',
          start_date: null,
          targets: [speciesTarget('Prunus avium')],
        }),
      ],
      plants: [
        makePlant('Malus domestica', 'Apple'),
        makePlant('Malus domestica', 'Apple'),
        makePlant('Prunus avium', 'Cherry'),
      ],
      localizedNames: new Map([['Malus domestica', 'Pommier']]),
      fallbackOriginMs: new Date('2026-01-01T00:00:00.000Z').getTime(),
      locale: 'fr',
    })

    const plantingRow = projection.rows.find((row) => row.actionType === 'planting')
    const harvestRow = projection.rows.find((row) => row.actionType === 'harvest')
    const otherRow = projection.rows.find((row) => row.actionType === 'other')

    expect(projection.rows.map((row) => row.actionType)).toEqual([
      'planting',
      'pruning',
      'harvest',
      'watering',
      'fertilising',
      'other',
    ])
    expect(plantingRow?.actions[0]).toMatchObject({
      id: 'plant-apple',
      actionType: 'planting',
      speciesCanonical: 'Malus domestica',
      targets: [speciesTarget('Malus domestica')],
    })
    expect(harvestRow?.actions[0]).toMatchObject({
      id: 'harvest-apple',
      speciesCanonical: null,
      targets: [MANUAL_TARGET],
    })
    expect(otherRow?.actions[0]?.id).toBe('unknown-type')
    expect(projection.layout.get('plant-apple')).toMatchObject({
      rowIndex: 0,
      subLane: 0,
      totalSubLanes: 1,
    })
    expect(projection.speciesList).toEqual([
      { canonical_name: 'Prunus avium', display_name: 'Cherry' },
      { canonical_name: 'Malus domestica', display_name: 'Pommier' },
    ])
    expect(new Date(projection.originMs).toISOString()).toBe('2026-03-11T00:00:00.000Z')
  })
})
