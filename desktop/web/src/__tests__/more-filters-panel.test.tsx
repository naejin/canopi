import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeciesCatalogWorkbench } from '../app/plant-browser/workbench'
import { createTestSpeciesCatalogWorkbench } from './support/species-catalog-workbench'

async function flushEffects(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('MoreFiltersPanel outside-click behavior', () => {
  let container: HTMLDivElement
  let MoreFiltersPanel: typeof import('../components/plant-db/MoreFiltersPanel').MoreFiltersPanel
  let locale: typeof import('../app/settings/state').locale
  let workbench: SpeciesCatalogWorkbench

  beforeEach(async () => {
    vi.resetModules()
    const settings = await import('../app/settings/state')
    locale = settings.locale
    locale.value = 'en'
    workbench = await createTestSpeciesCatalogWorkbench({
      locale,
      loadDynamicFilterOptions: async (fields) => fields.map((field) => ({
        field,
        field_type: 'numeric',
        values: null,
        range: [1, 13],
      })),
    })
    vi.doMock('../app/plant-browser', async () => {
      const actual = await vi.importActual<typeof import('../app/plant-browser')>('../app/plant-browser')
      return {
        ...actual,
        speciesCatalogWorkbench: workbench,
      }
    })
    ;({ MoreFiltersPanel } = await import('../components/plant-db/MoreFiltersPanel'))

    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    workbench.clearFilters()
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    workbench.dispose()
    vi.doUnmock('../app/plant-browser')
  })

  it('stays open when interacting with an overlay-preserving control outside the panel', async () => {
    const onClose = vi.fn()
    const preserveTarget = document.createElement('button')
    preserveTarget.setAttribute('data-preserve-overlays', 'true')
    document.body.appendChild(preserveTarget)

    await act(async () => {
      render(<MoreFiltersPanel open onClose={onClose} />, container)
      await flushEffects()
    })

    await act(async () => {
      preserveTarget.dispatchEvent(new Event('pointerup', { bubbles: true }))
      await flushEffects()
    })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('still closes on ordinary outside clicks', async () => {
    const onClose = vi.fn()

    await act(async () => {
      render(<MoreFiltersPanel open onClose={onClose} />, container)
      await flushEffects()
    })

    await act(async () => {
      document.dispatchEvent(new Event('pointerup'))
      await flushEffects()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('uses integer slider steps for hardiness filters', async () => {
    await workbench.loadDynamicOptions(['hardiness_zone_min'])

    await act(async () => {
      render(<MoreFiltersPanel open onClose={vi.fn()} />, container)
      await flushEffects()
    })

    const climateButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Climate & Soil'))
    expect(climateButton).toBeTruthy()

    await act(async () => {
      climateButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    const hardinessButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Hardiness zone min'))
    expect(hardinessButton).toBeTruthy()

    await act(async () => {
      hardinessButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    const rangeInputs = Array.from(container.querySelectorAll('input[type="range"]'))
    expect(rangeInputs).toHaveLength(2)
    expect(rangeInputs.every((input) => (input as HTMLInputElement).step === '1')).toBe(true)
  })
})
