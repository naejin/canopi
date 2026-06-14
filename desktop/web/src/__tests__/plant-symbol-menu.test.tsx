import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlantSymbolMenu } from '../components/canvas/PlantSymbolMenu'
import { setCurrentCanvasSession } from '../canvas/session'
import { plantSymbolMenuOpen } from '../canvas/plant-symbol-menu-state'
import { selectedObjectIds } from '../canvas/session-state'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

describe('PlantSymbolMenu', () => {
  let container: HTMLDivElement
  const setSelectedPlantSymbol = vi.fn()
  const setPlantSymbolForSpecies = vi.fn()
  const clearPlantSpeciesSymbol = vi.fn()
  const getSelectedPlantSymbolContext = vi.fn()
  const buttonRef = { current: null as HTMLButtonElement | null }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    setSelectedPlantSymbol.mockReset()
    setPlantSymbolForSpecies.mockReset()
    clearPlantSpeciesSymbol.mockReset()
    getSelectedPlantSymbolContext.mockReset()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        plantPresentation: {
          setSelectedPlantSymbol,
          setPlantSymbolForSpecies,
          clearPlantSpeciesSymbol,
        },
      }),
      queries: {
        ...createTestCanvasQuerySurface(),
        getSelectedPlantSymbolContext,
      },
    }))
    buttonRef.current = document.createElement('button')
    selectedObjectIds.value = new Set(['plant-1'])
    plantSymbolMenuOpen.value = true
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    selectedObjectIds.value = new Set()
    plantSymbolMenuOpen.value = false
    setCurrentCanvasSession(null)
  })

  it('applies an icon-only symbol choice to the current plant selection', async () => {
    getSelectedPlantSymbolContext.mockReturnValue({
      plantIds: ['plant-1', 'plant-2'],
      singleSpeciesCanonicalName: 'Malus domestica',
      singleSpeciesCommonName: 'Apple',
      sharedCurrentSymbol: null,
      sharedEffectiveSymbol: 'round',
      inheritedSymbol: null,
      singleSpeciesDefaultSymbol: null,
      canClearSelectedSymbol: false,
    })

    await act(async () => {
      render(<PlantSymbolMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const triangleButton = container.querySelector<HTMLButtonElement>('button[aria-label="Triangle"]')
    expect(triangleButton).not.toBeNull()
    expect(triangleButton?.title).toBe('Triangle')
    expect(triangleButton?.textContent).toBe('')

    await act(async () => {
      triangleButton?.click()
      await Promise.resolve()
    })

    const setSymbolButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Set symbol'),
    ) as HTMLButtonElement

    await act(async () => {
      setSymbolButton.click()
      await Promise.resolve()
    })

    expect(setSelectedPlantSymbol).toHaveBeenCalledWith('triangle')
    expect(plantSymbolMenuOpen.value).toBe(false)
  })

  it('clears selected plant symbol overrides back to inherited symbols', async () => {
    getSelectedPlantSymbolContext.mockReturnValue({
      plantIds: ['plant-1'],
      singleSpeciesCanonicalName: 'Malus domestica',
      singleSpeciesCommonName: 'Apple',
      sharedCurrentSymbol: 'tree',
      sharedEffectiveSymbol: 'tree',
      inheritedSymbol: 'round',
      singleSpeciesDefaultSymbol: 'round',
      canClearSelectedSymbol: true,
    })

    await act(async () => {
      render(<PlantSymbolMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const clearSymbolButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Clear symbol'),
    ) as HTMLButtonElement
    expect(clearSymbolButton.disabled).toBe(false)

    await act(async () => {
      clearSymbolButton.click()
      await Promise.resolve()
    })

    expect(setSelectedPlantSymbol).toHaveBeenCalledWith(null)
    expect(plantSymbolMenuOpen.value).toBe(false)
  })

  it('applies the selected symbol to all placed instances of the selected species', async () => {
    getSelectedPlantSymbolContext.mockReturnValue({
      plantIds: ['plant-1'],
      singleSpeciesCanonicalName: 'Malus domestica',
      singleSpeciesCommonName: 'Apple',
      sharedCurrentSymbol: null,
      sharedEffectiveSymbol: 'round',
      inheritedSymbol: 'round',
      singleSpeciesDefaultSymbol: null,
      canClearSelectedSymbol: false,
    })

    await act(async () => {
      render(<PlantSymbolMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const treeButton = container.querySelector<HTMLButtonElement>('button[aria-label="Tree"]')
    await act(async () => {
      treeButton?.click()
      await Promise.resolve()
    })

    const setAllButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Set for all Apple'),
    ) as HTMLButtonElement

    await act(async () => {
      setAllButton.click()
      await Promise.resolve()
    })

    expect(setPlantSymbolForSpecies).toHaveBeenCalledWith('Malus domestica', 'tree')
    expect(plantSymbolMenuOpen.value).toBe(false)
  })

  it('clears the species symbol default separately from selected plant overrides', async () => {
    getSelectedPlantSymbolContext.mockReturnValue({
      plantIds: ['plant-1'],
      singleSpeciesCanonicalName: 'Malus domestica',
      singleSpeciesCommonName: 'Apple',
      sharedCurrentSymbol: 'triangle',
      sharedEffectiveSymbol: 'triangle',
      inheritedSymbol: 'round',
      singleSpeciesDefaultSymbol: 'round',
      canClearSelectedSymbol: true,
    })

    await act(async () => {
      render(<PlantSymbolMenu buttonRef={buttonRef} />, container)
      await Promise.resolve()
    })

    const clearSpeciesButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Clear species default'),
    ) as HTMLButtonElement

    await act(async () => {
      clearSpeciesButton.click()
      await Promise.resolve()
    })

    expect(clearPlantSpeciesSymbol).toHaveBeenCalledWith('Malus domestica')
    expect(plantSymbolMenuOpen.value).toBe(false)
  })
})
