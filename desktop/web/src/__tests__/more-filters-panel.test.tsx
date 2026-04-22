import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MoreFiltersPanel } from '../components/plant-db/MoreFiltersPanel'
import { dynamicOptionsCache, dynamicOptionsErrors, dynamicOptionsPending, extraFilters } from '../app/plant-browser'
import { locale } from '../app/settings/state'

async function flushEffects(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('MoreFiltersPanel outside-click behavior', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    extraFilters.value = []
    dynamicOptionsCache.value = {}
    dynamicOptionsPending.value = {}
    dynamicOptionsErrors.value = {}
  })

  afterEach(() => {
    render(null, container)
    container.remove()
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
    dynamicOptionsCache.value = {
      en: {
        hardiness_zone_min: {
          field: 'hardiness_zone_min',
          field_type: 'numeric',
          values: null,
          range: [1, 13],
        },
      },
    }

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

  it('removes full-range numeric extras as no-op and keeps narrowed upper bounds', async () => {
    dynamicOptionsCache.value = {
      en: {
        medicinal_rating: {
          field: 'medicinal_rating',
          field_type: 'numeric',
          values: null,
          range: [0, 5],
        },
      },
    }

    await act(async () => {
      render(<MoreFiltersPanel open onClose={vi.fn()} />, container)
      await flushEffects()
    })

    const usesButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Uses'))
    expect(usesButton).toBeTruthy()

    await act(async () => {
      usesButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    const medicinalButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Medicinal rating'))
    expect(medicinalButton).toBeTruthy()

    await act(async () => {
      medicinalButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    const rangeInputs = Array.from(container.querySelectorAll('input[type="range"]')) as HTMLInputElement[]
    expect(rangeInputs).toHaveLength(2)

    await act(async () => {
      rangeInputs[1]!.value = '2'
      rangeInputs[1]!.dispatchEvent(new Event('input', { bubbles: true }))
      await flushEffects()
    })

    expect(extraFilters.value).toEqual([{ field: 'medicinal_rating', op: 'Between', values: ['0', '2'] }])

    await act(async () => {
      rangeInputs[1]!.value = '5'
      rangeInputs[1]!.dispatchEvent(new Event('input', { bubbles: true }))
      await flushEffects()
    })

    expect(extraFilters.value).toEqual([])
  })
})
