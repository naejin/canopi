import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  gridVisible,
  rulersVisible,
  snapToGridEnabled,
} from '../app/canvas-settings/signals'
import { locale } from '../app/settings/state'
import { plantColorMenuOpen } from '../canvas/plant-color-menu-state'
import { plantSymbolMenuOpen } from '../canvas/plant-symbol-menu-state'
import { setCurrentCanvasSession } from '../canvas/session'
import { activeTool, selectedObjectIds } from '../canvas/session-state'
import { WebCanvasToolbar } from '../web/WebCanvasToolbar'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

describe('WebCanvasToolbar', () => {
  let container: HTMLDivElement
  const canUndo = signal(false)
  const canRedo = signal(false)
  const setSelectedPlantColor = vi.fn()
  const setSelectedPlantSymbol = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    activeTool.value = 'select'
    selectedObjectIds.value = new Set()
    plantColorMenuOpen.value = false
    plantSymbolMenuOpen.value = false
    gridVisible.value = true
    snapToGridEnabled.value = false
    rulersVisible.value = true
    setSelectedPlantColor.mockReset()
    setSelectedPlantSymbol.mockReset()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        history: {
          canUndo,
          canRedo,
          undo: vi.fn(),
          redo: vi.fn(),
        },
        plantPresentation: {
          ensureSpeciesCacheEntries: vi.fn().mockResolvedValue(false),
          setSelectedPlantColor,
          setSelectedPlantSymbol,
          setPlantColorForSpecies: vi.fn(),
          setPlantSymbolForSpecies: vi.fn(),
          clearPlantSpeciesColor: vi.fn(),
          clearPlantSpeciesSymbol: vi.fn(),
        },
      }),
      queries: {
        ...createTestCanvasQuerySurface(),
        getSelectedPlantColorContext: vi.fn(() => selectedObjectIds.value.size === 0
          ? {
            plantIds: [],
            singleSpeciesCanonicalName: null,
            singleSpeciesCommonName: null,
            sharedCurrentColor: null,
            suggestedColor: null,
            singleSpeciesDefaultColor: null,
          }
          : {
            plantIds: ['plant-1'],
            singleSpeciesCanonicalName: 'Malus domestica',
            singleSpeciesCommonName: 'Apple',
            sharedCurrentColor: null,
            suggestedColor: '#C8A51E',
            singleSpeciesDefaultColor: null,
          }),
        getSelectedPlantSymbolContext: vi.fn(() => selectedObjectIds.value.size === 0
          ? {
            plantIds: [],
            singleSpeciesCanonicalName: null,
            singleSpeciesCommonName: null,
            sharedCurrentSymbol: null,
            sharedEffectiveSymbol: 'round' as const,
            inheritedSymbol: null,
            singleSpeciesDefaultSymbol: null,
            canClearSelectedSymbol: false,
          }
          : {
            plantIds: ['plant-1'],
            singleSpeciesCanonicalName: 'Malus domestica',
            singleSpeciesCommonName: 'Apple',
            sharedCurrentSymbol: null,
            sharedEffectiveSymbol: 'round' as const,
            inheritedSymbol: null,
            singleSpeciesDefaultSymbol: null,
            canClearSelectedSymbol: false,
          }),
      },
    }))
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    selectedObjectIds.value = new Set()
    plantColorMenuOpen.value = false
    plantSymbolMenuOpen.value = false
    setCurrentCanvasSession(null)
  })

  it('enables desktop Plant Color and Plant Symbol menus for the selected Web plant', async () => {
    await act(async () => {
      render(<WebCanvasToolbar />, container)
    })

    const colorButton = button('Plant color')
    const symbolButton = button('Plant symbol')
    expect(colorButton.disabled).toBe(true)
    expect(symbolButton.disabled).toBe(true)

    await act(async () => {
      selectedObjectIds.value = new Set(['plant-1'])
      await Promise.resolve()
    })

    expect(colorButton.disabled).toBe(false)
    expect(symbolButton.disabled).toBe(false)

    await act(async () => {
      colorButton.click()
      await Promise.resolve()
    })
    expect(container.querySelector('[role="dialog"][aria-label="Plant color"]')).not.toBeNull()

    await act(async () => {
      symbolButton.click()
      await Promise.resolve()
    })
    expect(container.querySelector('[role="dialog"][aria-label="Plant symbol"]')).not.toBeNull()
  })

  it('exposes Plant Spacing as a Web canvas tool', async () => {
    await act(async () => {
      render(<WebCanvasToolbar />, container)
    })

    const plantSpacing = button('Plant Spacing')
    expect(plantSpacing.dataset.tool).toBe('plant-spacing')
    expect(plantSpacing.disabled).toBe(false)

    await act(async () => {
      plantSpacing.click()
      await Promise.resolve()
    })

    expect(activeTool.value).toBe('plant-spacing')
    expect(plantSpacing.getAttribute('aria-checked')).toBe('true')
  })

  function button(label: string): HTMLButtonElement {
    const element = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    if (!element) throw new Error(`Missing ${label} button`)
    return element
  }
})
