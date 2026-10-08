import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LidarPresentationItem } from '../app/lidar/library-store'

const setLidarEntryDisplay = vi.hoisted(() => vi.fn())
vi.mock('../app/lidar/actions', () => ({ setLidarEntryDisplay }))

import { RasterDisplayControls } from '../components/panels/lidar/RasterDisplayControls'
import { locale } from '../app/settings/state'

let container: HTMLDivElement

function item(overrides: Partial<LidarPresentationItem> = {}): LidarPresentationItem {
  return {
    kind: 'Source', id: 'a', name: 'Ground', availability: 'present',
    itemType: { kind: 'Raster', quantity: 'GroundElevation' }, units: 'm', state: 'Ready',
    visible: true, shown: true, opacity: 1, order: 0, ramp: null, reversed: false, range: null,
    bounds: [0, 0, 1, 1], generationId: 'a-g1', displayRange: [100, 200], freshness: { state: 'Current' },
    definitionId: null, analysisId: null, outputKey: null, run: null, inputId: null, parentId: null, depth: 0,
    ...overrides,
  }
}

const slope = { kind: 'Derived' as const, itemType: { kind: 'Raster' as const, quantity: 'Slope' as const }, units: '°', displayRange: [0, 41.6] as [number, number] }

function mount(entry: LidarPresentationItem): void {
  act(() => { render(<RasterDisplayControls item={entry} />, container) })
}

function radios(group: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>(`[role="radiogroup"][aria-label="${group}"] [role="radio"]`))
}

function named(name: string): HTMLElement {
  const found = Array.from(container.querySelectorAll<HTMLElement>('button, input'))
    .find((candidate) => (candidate.getAttribute('aria-label') ?? candidate.textContent?.trim()) === name)
  if (!found) throw new Error(`no control ${name}`)
  return found
}

async function click(target: HTMLElement): Promise<void> {
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

async function type(field: HTMLInputElement, text: string, commit: 'Enter' | 'blur'): Promise<void> {
  await act(async () => {
    field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    if (commit === 'Enter') field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    else field.dispatchEvent(new FocusEvent('blur'))
  })
}

function legend(): string[] {
  return Array.from(container.querySelectorAll('[aria-label="Legend"] [data-legend-end]')).map((end) => end.textContent ?? '')
}

beforeEach(() => {
  locale.value = 'en'
  setLidarEntryDisplay.mockClear()
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  render(null, container)
  container.remove()
})

describe('an open item\'s Colors', () => {
  it('offers its kind\'s three ramps as swatches, the default chosen, and writes a choice', async () => {
    mount(item())
    expect(radios('Colors').map((radio) => [radio.getAttribute('aria-label'), radio.getAttribute('aria-checked')]))
      .toEqual([['Terrain', 'true'], ['Earth', 'false'], ['Gray', 'false']])
    expect(radios('Colors')[0]!.querySelector<HTMLElement>('[data-swatch]')!.style.backgroundImage).toContain('linear-gradient')
    await click(radios('Colors')[1]!)
    expect(setLidarEntryDisplay).toHaveBeenCalledWith('a', { ramp: 'Earth' })
  })

  it('offers a slope Yellow–red, Magma and Gray, and a height Greens, Magma and Gray', () => {
    mount(item(slope))
    expect(radios('Colors').map((radio) => radio.getAttribute('aria-label'))).toEqual(['Yellow–red', 'Magma', 'Gray'])
    mount(item({ itemType: { kind: 'Raster', quantity: 'AboveGroundHeight' } }))
    expect(radios('Colors').map((radio) => radio.getAttribute('aria-label'))).toEqual(['Greens', 'Magma', 'Gray'])
  })

  it('reverses the ramp as a pressed toggle', async () => {
    mount(item({ reversed: true }))
    const reverse = named('Reverse')
    expect(reverse.getAttribute('aria-pressed')).toBe('true')
    await click(reverse)
    expect(setLidarEntryDisplay).toHaveBeenCalledWith('a', { reversed: false })
  })

  it('labels the legend with the range in use, marked ≤ and ≥ where it cuts the data', () => {
    mount(item())
    expect(legend()).toEqual(['100 m', '200 m'])
    mount(item({ range: { mode: 'Custom', min: 110, max: 190 } }))
    expect(legend()).toEqual(['≤ 110 m', '≥ 190 m'])
  })
})

describe('an open item\'s Range', () => {
  it('shows the mode and the values in use, and switches mode with one write', async () => {
    mount(item())
    expect(radios('Range').map((radio) => [radio.textContent, radio.getAttribute('aria-checked')]))
      .toEqual([['Data range', 'true'], ['Cut outliers', 'false'], ['Custom', 'false']])
    expect((named('Minimum') as HTMLInputElement).value).toBe('100')
    expect((named('Maximum') as HTMLInputElement).value).toBe('200')
    await click(radios('Range')[1]!)
    expect(setLidarEntryDisplay).toHaveBeenLastCalledWith('a', { range: { mode: 'CutOutliers' } })
    await click(radios('Range')[2]!)
    expect(setLidarEntryDisplay).toHaveBeenLastCalledWith('a', { range: { mode: 'Custom', min: 100, max: 200 } })
  })

  it('shows a slope\'s default 0–30° as Custom, with no Reset', () => {
    mount(item(slope))
    expect(radios('Range').find((radio) => radio.getAttribute('aria-checked') === 'true')?.textContent).toBe('Custom')
    expect((named('Maximum') as HTMLInputElement).value).toBe('30')
    expect(() => named('Reset')).toThrow()
  })

  it('commits Custom only for a pair that parses in the locale with minimum below maximum, else reverts', async () => {
    locale.value = 'fr'
    mount(item())
    const minimum = named('Minimum') as HTMLInputElement
    await type(minimum, '110,5', 'Enter')
    expect(setLidarEntryDisplay).toHaveBeenCalledWith('a', { range: { mode: 'Custom', min: 110.5, max: 200 } })
    setLidarEntryDisplay.mockClear()
    await type(minimum, '250', 'blur')
    expect(setLidarEntryDisplay).not.toHaveBeenCalled()
    expect(minimum.value).toBe('100')
    await type(named('Maximum') as HTMLInputElement, 'deux cents', 'Enter')
    expect(setLidarEntryDisplay).not.toHaveBeenCalled()
    expect((named('Maximum') as HTMLInputElement).value).toBe('200')
  })

  it('shows Reset only when the display differs from the kind\'s, and Reset restores colours, Reverse and range', async () => {
    mount(item())
    expect(() => named('Reset')).toThrow()
    mount(item({ ramp: 'Gray' }))
    await click(named('Reset'))
    expect(setLidarEntryDisplay).toHaveBeenCalledWith('a', { ramp: null, reversed: false, range: null })
    mount(item({ reversed: true }))
    expect(named('Reset')).toBeTruthy()
  })

  it('keeps the field and its focus when an Enter commit or a new range in use lands, and a draft being typed', async () => {
    mount(item())
    const minimum = named('Minimum') as HTMLInputElement
    minimum.focus()
    await type(minimum, '150', 'Enter')
    expect(setLidarEntryDisplay).toHaveBeenCalledWith('a', { range: { mode: 'Custom', min: 150, max: 200 } })
    mount(item({ range: { mode: 'Custom', min: 150, max: 200 } }))
    expect(named('Minimum')).toBe(minimum)
    expect(document.activeElement).toBe(minimum)
    expect(minimum.value).toBe('150')
    // A range that lands while Maximum holds a draft keeps the draft; an untouched field shows the new value.
    const maximum = named('Maximum') as HTMLInputElement
    await act(async () => {
      maximum.value = '18'
      maximum.dispatchEvent(new Event('input', { bubbles: true }))
    })
    mount(item({ range: { mode: 'Custom', min: 120, max: 190 } }))
    expect(named('Maximum')).toBe(maximum)
    expect(maximum.value).toBe('18')
    expect(minimum.value).toBe('120')
  })

  it('keeps focus in the Range fields after Reset removes itself', async () => {
    mount(item({ ramp: 'Gray' }))
    const reset = named('Reset')
    reset.focus()
    await click(reset)
    mount(item())
    expect(document.activeElement).toBe(named('Minimum'))
  })

  it('writes opacity live as the slider moves', async () => {
    mount(item())
    const slider = container.querySelector<HTMLInputElement>('input[aria-label="Opacity: Ground"]')!
    await act(async () => {
      slider.value = '40'
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(setLidarEntryDisplay).toHaveBeenCalledWith('a', { opacity: 0.4 })
  })
})
