import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BudgetTab } from '../components/canvas/BudgetTab'
import { currentCanvasSession } from '../canvas/session'
import { currentDesign } from './support/design-session-state'
import { locale } from '../app/settings/state'
import { plantNamesRevision, sceneEntityRevision } from '../canvas/runtime-mirror-state'
import {
  budgetPriceDraftValue,
  parseBudgetPriceDraft,
} from '../app/budget/workbench'
import type { CanopiFile, PlacedPlant } from '../types/design'

function makeDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 2,
    name: 'Budget workbench test',
    description: null,
    location: null,
    north_bearing_deg: null,
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    extra: {},
    created_at: '2026-04-08T00:00:00.000Z',
    updated_at: '2026-04-08T00:00:00.000Z',
    ...overrides,
  }
}

function makePlant(canonicalName: string, commonName: string): PlacedPlant {
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

describe('Budget Item workbench', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    sceneEntityRevision.value = 0
    plantNamesRevision.value = 0
    currentDesign.value = makeDesign()
    currentCanvasSession.value = {
      getPlacedPlants: () => [makePlant('Malus domestica', 'Apple')],
      getLocalizedCommonNames: () => new Map(),
    } as any
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    currentDesign.value = null
    currentCanvasSession.value = null
  })

  it('parses zero-price drafts without conflating them with an empty draft', () => {
    expect(parseBudgetPriceDraft('0')).toBe(0)
    expect(parseBudgetPriceDraft('0.00')).toBe(0)
    expect(parseBudgetPriceDraft('')).toBeNull()
    expect(parseBudgetPriceDraft('  ')).toBeNull()
    expect(budgetPriceDraftValue(0)).toBe('0')
    expect(budgetPriceDraftValue(undefined)).toBe('')
  })

  it('commits a zero price through the workbench edit lifecycle', async () => {
    await act(async () => {
      render(<BudgetTab />, container)
    })

    const priceButton = container.querySelector<HTMLButtonElement>('tbody button')
    expect(priceButton).toBeTruthy()

    await act(async () => {
      priceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const input = container.querySelector<HTMLInputElement>('tbody input[type="number"]')
    expect(input).toBeTruthy()

    await act(async () => {
      if (!input) return
      input.value = '0'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    })

    expect(currentDesign.value?.budget).toHaveLength(1)
    expect(currentDesign.value?.budget[0]).toMatchObject({
      description: 'Malus domestica',
      unit_cost: 0,
      currency: 'EUR',
    })
    expect(container.textContent).toContain('EUR')
    expect(container.textContent).toContain('0.00')
  })
})
