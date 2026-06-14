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
  const getSelectedPlantSymbolContext = vi.fn()
  const buttonRef = { current: null as HTMLButtonElement | null }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    setSelectedPlantSymbol.mockReset()
    getSelectedPlantSymbolContext.mockReset()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        plantPresentation: {
          setSelectedPlantSymbol,
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
})
