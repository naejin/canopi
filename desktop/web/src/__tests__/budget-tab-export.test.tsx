import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exportBudgetCsv: vi.fn(),
}))

vi.mock('../app/budget/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../app/budget/export')>()
  return {
    ...actual,
    exportBudgetCsv: mocks.exportBudgetCsv,
  }
})

import { BudgetTab } from '../components/canvas/BudgetTab'
import { currentCanvasSession } from '../canvas/session'
import { locale } from '../app/settings/state'
import { currentDesign } from '../state/design'
import { plantNamesRevision, sceneEntityRevision } from '../canvas/runtime-mirror-state'
import { speciesBudgetTarget } from '../panel-targets'
import type { CanopiFile, PlacedPlant } from '../types/design'

function makeDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 2,
    name: 'Budget export test',
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

describe('BudgetTab export', () => {
  let container: HTMLDivElement
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    sceneEntityRevision.value = 0
    plantNamesRevision.value = 0
    currentDesign.value = makeDesign({
      budget_currency: 'EUR',
      budget: [
        {
          target: speciesBudgetTarget('Malus domestica'),
          category: 'plants',
          description: 'Malus domestica',
          quantity: 0,
          unit_cost: 5,
          currency: 'EUR',
        },
      ],
    })
    currentCanvasSession.value = {
      getPlacedPlants: () => [makePlant('Malus domestica', 'Apple')],
      getLocalizedCommonNames: () => new Map(),
    } as any
    mocks.exportBudgetCsv.mockReset()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
    render(null, container)
    container.remove()
    currentDesign.value = null
    currentCanvasSession.value = null
  })

  it('logs non-cancelled export failures instead of swallowing them', async () => {
    mocks.exportBudgetCsv.mockRejectedValueOnce(new Error('disk full'))

    await act(async () => {
      render(<BudgetTab />, container)
    })

    const button = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.toLowerCase().includes('csv'),
    )

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(consoleError).toHaveBeenCalledWith('Budget export failed:', expect.any(Error))
  })

  it('ignores dialog-cancelled export failures', async () => {
    mocks.exportBudgetCsv.mockRejectedValueOnce(new Error('Dialog cancelled'))

    await act(async () => {
      render(<BudgetTab />, container)
    })

    const button = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.toLowerCase().includes('csv'),
    )

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(consoleError).not.toHaveBeenCalled()
  })
})
