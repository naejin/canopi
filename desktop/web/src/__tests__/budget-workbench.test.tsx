import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BudgetPanel } from '../components/panels/BudgetPanel'
import { setCurrentCanvasSession } from '../canvas/session'
import {
  designSessionFixture,
  currentDesign,
} from './support/design-session-state'
import { locale } from '../app/settings/state'
import {
  budgetPriceDraftValue,
  parseBudgetPriceDraft,
} from '../app/budget/workbench'
import type { CanopiFile, PlacedPlant } from '../types/design'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'

function makeDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 7,
    name: 'Budget workbench test',
    description: null,
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
    position: { lon: 13, lat: 23 },
    rotation: null,
    scale: null,
    notes: null,
    planted_date: null,
    quantity: 1,
    locked: false,
  }
}

describe('Budget Item workbench', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    designSessionFixture.file = makeDesign()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: createTestCanvasQuerySurface({
        plants: [makePlant('Malus domestica', 'Apple')],
      }),
    }))
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    designSessionFixture.file = null
    setCurrentCanvasSession(null)
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
      render(<BudgetPanel />, container)
    })

    const priceButton = container.querySelector<HTMLButtonElement>('button[aria-label^="Unit cost"]')
    expect(priceButton).toBeTruthy()

    await act(async () => {
      priceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const input = container.querySelector<HTMLInputElement>('input[type="number"]')
    expect(input).toBeTruthy()

    await act(async () => {
      if (!input) return
      input.focus()
      input.value = '0'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      input?.blur()
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

  it('rejects invalid blur and lets Escape suppress a later valid blur', async () => {
    await act(async () => { render(<BudgetPanel />, container) })
    const priceButton = container.querySelector<HTMLButtonElement>('button[aria-label^="Unit cost"]')!

    await act(async () => { priceButton.click() })
    let input = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await act(async () => {
      input.value = '-2'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    })
    expect(currentDesign.value?.budget).toEqual([])
    expect(container.querySelector('[role="alert"]')).not.toBeNull()

    await act(async () => {
      input = container.querySelector<HTMLInputElement>('input[type="number"]')!
      input.value = '7'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    })
    expect(currentDesign.value?.budget).toEqual([])
    expect(container.querySelector('input[type="number"]')).toBeNull()
    expect((document.activeElement as HTMLButtonElement)?.getAttribute('data-budget-price')).toContain('Malus')
  })

  it('advances after Enter and ignores the previous input blur', async () => {
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: createTestCanvasQuerySurface({
        plants: [
          makePlant('Malus domestica', 'Apple'),
          makePlant('Prunus avium', 'Cherry'),
        ],
      }),
    }))
    await act(async () => { render(<BudgetPanel />, container) })
    const priceButton = container.querySelector<HTMLButtonElement>('button[aria-label="Unit cost for Apple"]')!
    await act(async () => { priceButton.click() })
    const appleInput = container.querySelector<HTMLInputElement>('input[type="number"]')!

    await act(async () => {
      appleInput.value = '4'
      appleInput.dispatchEvent(new Event('input', { bubbles: true }))
      appleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      appleInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    })

    expect(currentDesign.value?.budget).toHaveLength(1)
    expect(currentDesign.value?.budget[0]?.unit_cost).toBe(4)
    expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.id).toContain('Prunus')
  })

  it('cancels an editor when another Design replaces the session', async () => {
    await act(async () => { render(<BudgetPanel />, container) })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label^="Unit cost"]')!.click()
    })
    const staleInput = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await act(async () => {
      staleInput.value = '9'
      staleInput.dispatchEvent(new Event('input', { bubbles: true }))
      designSessionFixture.file = makeDesign({ name: 'Replacement budget' })
    })
    await act(async () => {
      staleInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    })

    expect(container.querySelector('input[type="number"]')).toBeNull()
    expect(currentDesign.value?.name).toBe('Replacement budget')
    expect(currentDesign.value?.budget).toEqual([])
  })
})
