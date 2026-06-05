import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasToolbar } from '../components/canvas/CanvasToolbar'
import { setCurrentCanvasSession } from '../canvas/session'
import { plantColorMenuOpen } from '../canvas/plant-color-menu-state'
import { activeTool, selectedObjectIds } from '../canvas/session-state'
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
  const setTool = vi.fn()
  const undo = vi.fn()
  const redo = vi.fn()

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
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        canUndo,
        canRedo,
        setTool,
        undo,
        redo,
        ensureSpeciesCacheEntries: vi.fn().mockResolvedValue(false),
        toggleGrid: vi.fn(),
        toggleSnapToGrid: vi.fn(),
        toggleRulers: vi.fn(),
        setSelectedPlantColor: vi.fn(),
        setPlantColorForSpecies: vi.fn(),
        clearPlantSpeciesColor: vi.fn(),
      }),
      queries: {
        ...createTestCanvasQuerySurface(),
        getSelectedPlantColorContext,
      },
    }))
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    activeTool.value = 'select'
    selectedObjectIds.value = new Set()
    plantColorMenuOpen.value = false
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
