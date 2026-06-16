import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasToolbar } from '../components/canvas/CanvasToolbar'
import { setCurrentCanvasSession } from '../canvas/session'
import { plantColorMenuOpen } from '../canvas/plant-color-menu-state'
import { plantSymbolMenuOpen } from '../canvas/plant-symbol-menu-state'
import { activeTool, selectedObjectIds } from '../canvas/session-state'
import { activePanel, sidePanel } from '../app/shell/state'
import {
  gridVisible,
  rulersVisible,
  snapToGridEnabled,
} from '../app/canvas-settings/signals'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

describe('CanvasToolbar', () => {
  let container: HTMLDivElement
  const canUndo = signal(false)
  const canRedo = signal(false)
  const getSelectedPlantColorContext = vi.fn()
  const getSelectedPlantSymbolContext = vi.fn()
  const setTool = vi.fn()
  const undo = vi.fn()
  const redo = vi.fn()
  const toggleGrid = vi.fn()
  const toggleSnapToGrid = vi.fn()
  const toggleRulers = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    activeTool.value = 'select'
    canUndo.value = false
    canRedo.value = false
    setTool.mockReset()
    undo.mockReset()
    redo.mockReset()
    toggleGrid.mockReset()
    toggleSnapToGrid.mockReset()
    toggleRulers.mockReset()
    selectedObjectIds.value = new Set()
    plantColorMenuOpen.value = false
    plantSymbolMenuOpen.value = false
    activePanel.value = 'canvas'
    sidePanel.value = null
    gridVisible.value = true
    snapToGridEnabled.value = false
    rulersVisible.value = true
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
    getSelectedPlantSymbolContext.mockImplementation(() => {
      if (selectedObjectIds.value.size === 0) {
        return {
          plantIds: [],
          singleSpeciesCanonicalName: null,
          singleSpeciesCommonName: null,
          sharedCurrentSymbol: null,
          sharedEffectiveSymbol: 'round',
          inheritedSymbol: null,
          singleSpeciesDefaultSymbol: null,
          canClearSelectedSymbol: false,
        }
      }
      return {
        plantIds: ['plant-1'],
        singleSpeciesCanonicalName: 'Malus domestica',
        singleSpeciesCommonName: 'Apple',
        sharedCurrentSymbol: null,
        sharedEffectiveSymbol: 'round',
        inheritedSymbol: null,
        singleSpeciesDefaultSymbol: null,
        canClearSelectedSymbol: false,
      }
    })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        tools: { setTool },
        history: {
          canUndo,
          canRedo,
          undo,
          redo,
        },
        chrome: {
          toggleGrid,
          toggleSnapToGrid,
          toggleRulers,
        },
        plantPresentation: {
          ensureSpeciesCacheEntries: vi.fn().mockResolvedValue(false),
          setSelectedPlantColor: vi.fn(),
          setPlantColorForSpecies: vi.fn(),
          clearPlantSpeciesColor: vi.fn(),
        },
      }),
      queries: {
        ...createTestCanvasQuerySurface(),
        getSelectedPlantColorContext,
        getSelectedPlantSymbolContext,
      },
    }))
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    activeTool.value = 'select'
    selectedObjectIds.value = new Set()
    plantColorMenuOpen.value = false
    plantSymbolMenuOpen.value = false
    activePanel.value = 'canvas'
    sidePanel.value = null
    gridVisible.value = true
    snapToGridEnabled.value = false
    rulersVisible.value = true
    setCurrentCanvasSession(null)
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

  it('shows a separate plant symbol button after plant color and opens the symbol popover', async () => {
    selectedObjectIds.value = new Set(['plant-1'])

    await act(async () => {
      render(<CanvasToolbar />, container)
      await Promise.resolve()
    })

    const toolbarLabels = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .map((button) => button.getAttribute('aria-label'))
    const plantColorIndex = toolbarLabels.indexOf('Plant color')
    expect(plantColorIndex).toBeGreaterThan(-1)
    expect(toolbarLabels[plantColorIndex + 1]).toBe('Plant symbol')

    const symbolButton = container.querySelector<HTMLButtonElement>('button[aria-label="Plant symbol"]')
    expect(symbolButton).not.toBeNull()
    expect(symbolButton?.disabled).toBe(false)

    await act(async () => {
      symbolButton?.click()
      await Promise.resolve()
    })

    expect(container.querySelector('[role="dialog"][aria-label="Plant symbol"]')).not.toBeNull()
  })

  it('uses a simple neutral marker icon for the plant symbol action', async () => {
    selectedObjectIds.value = new Set(['plant-1'])

    await act(async () => {
      render(<CanvasToolbar />, container)
      await Promise.resolve()
    })

    const symbolButton = container.querySelector<HTMLButtonElement>('button[aria-label="Plant symbol"]')
    const symbolIcon = symbolButton?.querySelector('svg[data-icon="plant-symbol-marker"]')

    expect(symbolIcon).toBeTruthy()
    expect(symbolIcon?.querySelector('[data-icon-part="marker"]')).toBeTruthy()
    expect(symbolIcon?.querySelector('[data-icon-part="sprout"]')).toBeTruthy()
    expect(symbolIcon?.outerHTML).not.toMatch(/#[0-9a-f]{3,8}|green/i)
  })

  it('exposes the ellipse shape tool in the toolbar', async () => {
    await act(async () => {
      render(<CanvasToolbar />, container)
      await Promise.resolve()
    })

    const button = container.querySelector<HTMLButtonElement>('button[data-tool="ellipse"]')
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-keyshortcuts')).toBe('E')

    await act(async () => {
      button?.click()
      await Promise.resolve()
    })

    expect(setTool).toHaveBeenCalledWith('ellipse')
  })

  it('orders toolbar tools by navigation, creation, and reuse groups', async () => {
    await act(async () => {
      render(<CanvasToolbar />, container)
      await Promise.resolve()
    })

    const tools = Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-tool]'))
      .map((button) => button.dataset.tool)

    expect(tools).toEqual([
      'select',
      'hand',
      'line',
      'rectangle',
      'ellipse',
      'polygon',
      'text',
      'object-stamp',
      'plant-spacing',
    ])
  })

  it('exposes the Line shape tool in the toolbar', async () => {
    await act(async () => {
      render(<CanvasToolbar />, container)
      await Promise.resolve()
    })

    const button = container.querySelector<HTMLButtonElement>('button[data-tool="line"]')
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-keyshortcuts')).toBe('L')

    await act(async () => {
      button?.click()
      await Promise.resolve()
    })

    expect(setTool).toHaveBeenCalledWith('line')
  })

  it('keeps an open side panel when clicking a toolbar tool', async () => {
    sidePanel.value = 'plant-db'

    await act(async () => {
      render(<CanvasToolbar />, container)
      await Promise.resolve()
    })

    const button = container.querySelector<HTMLButtonElement>('button[data-tool="ellipse"]')

    await act(async () => {
      button?.click()
      await Promise.resolve()
    })

    expect(setTool).toHaveBeenCalledWith('ellipse')
    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')
  })

  it('keeps an open side panel when arrow-key toolbar navigation changes tools', async () => {
    sidePanel.value = 'favorites'

    await act(async () => {
      render(<CanvasToolbar />, container)
      await Promise.resolve()
    })

    const button = container.querySelector<HTMLButtonElement>('button[data-tool="select"]')

    await act(async () => {
      button?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      await Promise.resolve()
    })

    expect(setTool).toHaveBeenCalledWith('hand')
    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('favorites')
  })

  it('exposes the polygon shape tool in the toolbar', async () => {
    await act(async () => {
      render(<CanvasToolbar />, container)
      await Promise.resolve()
    })

    const button = container.querySelector<HTMLButtonElement>('button[data-tool="polygon"]')
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-keyshortcuts')).toBe('P')

    await act(async () => {
      button?.click()
      await Promise.resolve()
    })

    expect(setTool).toHaveBeenCalledWith('polygon')
  })

  it('exposes Object Stamp in the toolbar', async () => {
    await act(async () => {
      render(<CanvasToolbar />, container)
      await Promise.resolve()
    })

    const button = container.querySelector<HTMLButtonElement>('button[data-tool="object-stamp"]')
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-label')).toBe('Object Stamp')

    await act(async () => {
      button?.click()
      await Promise.resolve()
    })

    expect(setTool).toHaveBeenCalledWith('object-stamp')
  })

  it('shows undo and redo command buttons disabled when history is unavailable', async () => {
    await act(async () => {
      render(<CanvasToolbar />, container)
      await Promise.resolve()
    })

    const undoButton = container.querySelector<HTMLButtonElement>('button[data-command="edit.undo"]')
    const redoButton = container.querySelector<HTMLButtonElement>('button[data-command="edit.redo"]')

    expect(undoButton).not.toBeNull()
    expect(redoButton).not.toBeNull()
    expect(undoButton?.disabled).toBe(true)
    expect(redoButton?.disabled).toBe(true)
    expect(undoButton?.getAttribute('aria-label')).toBe('Undo')
    expect(redoButton?.getAttribute('aria-label')).toBe('Redo')
    expect(undoButton?.getAttribute('aria-keyshortcuts')).toBe('Ctrl+Z')
    expect(redoButton?.getAttribute('aria-keyshortcuts')).toBe('Ctrl+Shift+Z')
  })

  it('runs undo and redo through the toolbar command buttons when history is available', async () => {
    canUndo.value = true
    canRedo.value = true

    await act(async () => {
      render(<CanvasToolbar />, container)
      await Promise.resolve()
    })

    const undoButton = container.querySelector<HTMLButtonElement>('button[data-command="edit.undo"]')
    const redoButton = container.querySelector<HTMLButtonElement>('button[data-command="edit.redo"]')

    expect(undoButton?.disabled).toBe(false)
    expect(redoButton?.disabled).toBe(false)

    await act(async () => {
      undoButton?.click()
      redoButton?.click()
      await Promise.resolve()
    })

    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(1)
  })

  it('runs grid, snap, and ruler toggles through toolbar command buttons', async () => {
    await act(async () => {
      render(<CanvasToolbar />, container)
      await Promise.resolve()
    })

    const gridButton = container.querySelector<HTMLButtonElement>('button[data-command="canvas.toggleGrid"]')
    const snapButton = container.querySelector<HTMLButtonElement>('button[data-command="canvas.toggleSnapToGrid"]')
    const rulersButton = container.querySelector<HTMLButtonElement>('button[data-command="canvas.toggleRulers"]')

    expect(gridButton).not.toBeNull()
    expect(snapButton).not.toBeNull()
    expect(rulersButton).not.toBeNull()
    expect(gridButton?.getAttribute('aria-pressed')).toBe('true')
    expect(snapButton?.getAttribute('aria-pressed')).toBe('false')
    expect(rulersButton?.getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      gridButton?.click()
      snapButton?.click()
      rulersButton?.click()
      await Promise.resolve()
    })

    expect(toggleGrid).toHaveBeenCalledTimes(1)
    expect(toggleSnapToGrid).toHaveBeenCalledTimes(1)
    expect(toggleRulers).toHaveBeenCalledTimes(1)
  })

  it('keeps arrow-key tool navigation scoped to tool buttons', async () => {
    canUndo.value = true

    await act(async () => {
      render(<CanvasToolbar />, container)
      await Promise.resolve()
    })

    const undoButton = container.querySelector<HTMLButtonElement>('button[data-command="edit.undo"]')
    undoButton?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))

    expect(setTool).not.toHaveBeenCalled()
    expect(activeTool.value).toBe('select')
  })
})
