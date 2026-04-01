import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasToolbar } from '../components/canvas/CanvasToolbar'
import { setCanvasEngine } from '../canvas/engine'
import { plantColorMenuOpen, selectedObjectIds } from '../state/canvas'

describe('CanvasToolbar plant color action', () => {
  let container: HTMLDivElement
  const getSelectedPlantColorContext = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    selectedObjectIds.value = new Set()
    plantColorMenuOpen.value = false
    getSelectedPlantColorContext.mockImplementation(() => {
      if (selectedObjectIds.value.size === 0) {
        return {
          plantIds: [],
          singleSpeciesCanonicalName: null,
          singleSpeciesCommonName: null,
          sharedCurrentColor: null,
          suggestedColor: null,
          singleSpeciesDefaultColor: null,
        }
      }
      return {
        plantIds: ['plant-1'],
        singleSpeciesCanonicalName: 'Malus domestica',
        singleSpeciesCommonName: 'Apple',
        sharedCurrentColor: null,
        suggestedColor: '#C8A51E',
        singleSpeciesDefaultColor: null,
      }
    })
    setCanvasEngine({
      getSelectedPlantColorContext,
      ensureSpeciesCacheEntries: vi.fn().mockResolvedValue(false),
      toggleGrid: vi.fn(),
      toggleSnapToGrid: vi.fn(),
      toggleRulers: vi.fn(),
      setSelectedPlantColor: vi.fn(),
      setPlantColorForSpecies: vi.fn(),
      clearPlantSpeciesColor: vi.fn(),
    } as any)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    selectedObjectIds.value = new Set()
    plantColorMenuOpen.value = false
    setCanvasEngine(null)
  })

  it('disables the plant color button until a plant is selected, then opens the popover', async () => {
    await act(async () => {
      render(<CanvasToolbar />, container)
      await Promise.resolve()
    })

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Plant color"]')
    expect(button).not.toBeNull()
    expect(button?.disabled).toBe(true)

    await act(async () => {
      selectedObjectIds.value = new Set(['plant-1'])
      await Promise.resolve()
    })

    expect(button?.disabled).toBe(false)

    await act(async () => {
      button?.click()
      await Promise.resolve()
    })

    expect(plantColorMenuOpen.value).toBe(true)
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  })
})
