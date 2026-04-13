import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlantColorMenu } from '../components/canvas/PlantColorMenu'
import { setCurrentCanvasSession } from '../canvas/session'
import { plantColorMenuOpen } from '../canvas/plant-color-menu-state'
import { selectedObjectIds } from '../canvas/session-state'

describe('PlantColorMenu', () => {
  let container: HTMLDivElement
  const setSelectedPlantColor = vi.fn()
  const setPlantColorForSpecies = vi.fn()
  const clearPlantSpeciesColor = vi.fn()
  const ensureSpeciesCacheEntries = vi.fn().mockResolvedValue(false)
  const getSelectedPlantColorContext = vi.fn()
  const buttonRef = { current: null as HTMLButtonElement | null }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    setSelectedPlantColor.mockReset()
    setPlantColorForSpecies.mockReset()
    clearPlantSpeciesColor.mockReset()
    ensureSpeciesCacheEntries.mockClear()
    getSelectedPlantColorContext.mockReset()
    setCurrentCanvasSession({
      setSelectedPlantColor,
      setPlantColorForSpecies,
      clearPlantSpeciesColor,
      ensureSpeciesCacheEntries,
      getSelectedPlantColorContext,
    } as any)
    buttonRef.current = document.createElement('button')
    selectedObjectIds.value = new Set(['plant-1'])
    plantColorMenuOpen.value = true
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    selectedObjectIds.value = new Set()
    plantColorMenuOpen.value = false
    setCurrentCanvasSession(null)
  })

  it('applies a selected palette color to the current plant selection', async () => {
    getSelectedPlantColorContext.mockReturnValue({
      plantIds: ['plant-1', 'plant-2'],
      singleSpeciesCanonicalName: 'Malus domestica',
      singleSpeciesCommonName: 'Apple',
      sharedCurrentColor: null,
      suggestedColor: '#C8A51E',
      singleSpeciesDefaultColor: null,
    })

    await act(async () => {
      render(<PlantColorMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const swatches = container.querySelectorAll('button[aria-selected]')
    const setColorButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Set color'),
    ) as HTMLButtonElement

    await act(async () => {
      ;(swatches[1] as HTMLButtonElement).click()
      await Promise.resolve()
    })

    await act(async () => {
      setColorButton.click()
      await Promise.resolve()
    })

    expect(setSelectedPlantColor).toHaveBeenCalledWith('#C44230')
    expect(plantColorMenuOpen.value).toBe(false)
  })

  it('applies the selected color to all placed instances of the selected species', async () => {
    getSelectedPlantColorContext.mockReturnValue({
      plantIds: ['plant-1'],
      singleSpeciesCanonicalName: 'Malus domestica',
      singleSpeciesCommonName: 'Apple',
      sharedCurrentColor: null,
      suggestedColor: '#C8A51E',
      singleSpeciesDefaultColor: null,
    })

    await act(async () => {
      render(<PlantColorMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const setAllButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Set for all'),
    ) as HTMLButtonElement

    await act(async () => {
      setAllButton.click()
      await Promise.resolve()
    })

    expect(setPlantColorForSpecies).toHaveBeenCalledWith('Malus domestica', '#C8A51E')
    expect(plantColorMenuOpen.value).toBe(false)
  })

  it('hides the species-wide action for mixed-species selections', async () => {
    getSelectedPlantColorContext.mockReturnValue({
      plantIds: ['plant-1', 'plant-2'],
      singleSpeciesCanonicalName: null,
      singleSpeciesCommonName: null,
      sharedCurrentColor: 'mixed',
      suggestedColor: null,
      singleSpeciesDefaultColor: null,
    })

    await act(async () => {
      render(<PlantColorMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    expect(
      [...container.querySelectorAll('button')].some((button) => button.textContent?.includes('Set for all')),
    ).toBe(false)
  })

  it('opens the advanced picker and keeps the custom swatch empty until a custom color is picked', async () => {
    getSelectedPlantColorContext.mockReturnValue({
      plantIds: ['plant-1'],
      singleSpeciesCanonicalName: 'Malus domestica',
      singleSpeciesCommonName: 'Apple',
      sharedCurrentColor: null,
      suggestedColor: '#C8A51E',
      singleSpeciesDefaultColor: null,
    })

    await act(async () => {
      render(<PlantColorMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const emptySwatch = container.querySelector('button[aria-label="No custom color selected"]') as HTMLButtonElement
    expect(emptySwatch).not.toBeNull()
    expect(emptySwatch.disabled).toBe(true)
    expect(emptySwatch.className).toContain('customSwatchEmpty')

    const moreColorsButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('More colors'),
    ) as HTMLButtonElement

    await act(async () => {
      moreColorsButton.click()
      await Promise.resolve()
    })

    expect(container.querySelector('[aria-label="Saturation and lightness"]')).not.toBeNull()
  })

  it('does not populate the custom swatch when only curated palette colors are used', async () => {
    getSelectedPlantColorContext.mockReturnValue({
      plantIds: ['plant-1'],
      singleSpeciesCanonicalName: 'Malus domestica',
      singleSpeciesCommonName: 'Apple',
      sharedCurrentColor: null,
      suggestedColor: '#C8A51E',
      singleSpeciesDefaultColor: null,
    })

    await act(async () => {
      render(<PlantColorMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const swatches = container.querySelectorAll('button[aria-selected]')
    await act(async () => {
      ;(swatches[1] as HTMLButtonElement).click()
      await Promise.resolve()
    })

    const emptySwatch = container.querySelector('button[aria-label="No custom color selected"]') as HTMLButtonElement
    expect(emptySwatch).not.toBeNull()
    expect(emptySwatch.disabled).toBe(true)
  })

  it('applies a valid advanced custom hex color and exposes it in the custom swatch', async () => {
    getSelectedPlantColorContext.mockReturnValue({
      plantIds: ['plant-1'],
      singleSpeciesCanonicalName: 'Malus domestica',
      singleSpeciesCommonName: 'Apple',
      sharedCurrentColor: null,
      suggestedColor: '#C8A51E',
      singleSpeciesDefaultColor: null,
    })

    await act(async () => {
      render(<PlantColorMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const moreColorsButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('More colors'),
    ) as HTMLButtonElement

    await act(async () => {
      moreColorsButton.click()
      await Promise.resolve()
    })

    const input = container.querySelector('input[placeholder="#C44230"]') as HTMLInputElement
    await act(async () => {
      input.value = '#123ABC'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    const customSwatch = container.querySelector('button[aria-label="Custom color"]') as HTMLButtonElement
    expect(customSwatch).not.toBeNull()
    expect(customSwatch.disabled).toBe(false)

    const setColorButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Set color'),
    ) as HTMLButtonElement

    await act(async () => {
      setColorButton.click()
      await Promise.resolve()
    })

    expect(setSelectedPlantColor).toHaveBeenCalledWith('#123ABC')
  })

  it('clears the species default separately from selected plant overrides', async () => {
    getSelectedPlantColorContext.mockReturnValue({
      plantIds: ['plant-1'],
      singleSpeciesCanonicalName: 'Malus domestica',
      singleSpeciesCommonName: 'Apple',
      sharedCurrentColor: '#C8A51E',
      suggestedColor: '#C8A51E',
      singleSpeciesDefaultColor: '#C8A51E',
    })

    await act(async () => {
      render(<PlantColorMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const clearSpeciesButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Clear species default'),
    ) as HTMLButtonElement

    await act(async () => {
      clearSpeciesButton.click()
      await Promise.resolve()
    })

    expect(clearPlantSpeciesColor).toHaveBeenCalledWith('Malus domestica')
    expect(plantColorMenuOpen.value).toBe(false)
  })
})
