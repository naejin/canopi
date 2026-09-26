import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolRail } from '../components/canvas/ToolRail'
import { ViewChip } from '../components/canvas/ViewChip'
import { workspaceCanvasCommandProjection } from '../app/workspace-commands/canvas-actions'
import {
  installToolRailLearning,
  RAIL_TOOL_IDS,
  toggleToolNames,
  toolRailShowsNames,
} from '../app/tool-rail/learning'
import { toolNamesVisible, usedCanvasTools } from '../app/settings/state'
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

/** The rail as both editions mount it: the shared projection and the first-use setting. */
function Rail() {
  return <ToolRail projection={workspaceCanvasCommandProjection.value} showNames={toolRailShowsNames.value} />
}

function Chip() {
  return <ViewChip toggles={workspaceCanvasCommandProjection.value.settingsToggles} />
}

describe('ToolRail', () => {
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
    usedCanvasTools.value = []
    toolNamesVisible.value = null
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

  const mount = async (node = <Rail />) => {
    await act(async () => {
      render(node, container)
      await Promise.resolve()
    })
  }
  const railButton = (command: string) => container.querySelector<HTMLButtonElement>(`button[data-command="${command}"]`)!

  it('shows names and keys until every tool has been used once, then 52 px icons with tooltips', async () => {
    await mount()
    const rail = container.querySelector('[role="toolbar"]')!
    expect(rail.getAttribute('data-tool-rail')).toBe('named')
    expect(railButton('canvas.tool.plantSpacing').textContent).toBe('Plant a rowW')
    expect(railButton('canvas.tool.plantSpacing').hasAttribute('aria-label')).toBe(false)
    expect(container.textContent).toContain('Zones')
    expect(railButton('edit.undo').textContent).toBe('UndoCtrl Z')

    await act(async () => {
      usedCanvasTools.value = [...RAIL_TOOL_IDS]
    })
    expect(rail.getAttribute('data-tool-rail')).toBe('icons')
    const polygon = railButton('canvas.tool.polygon')
    expect(polygon.getAttribute('aria-label')).toBe('Polygon zone (Z)')
    expect(polygon.querySelector('[role="tooltip"]')?.textContent).toBe('Polygon zoneZ')
    expect(container.textContent).not.toContain('Zones')
  })

  it('records each tool the first time it becomes active, not the tool a canvas starts with', async () => {
    const uninstall = installToolRailLearning()
    try {
      expect(usedCanvasTools.value).toEqual([])
      await act(async () => { activeTool.value = 'polygon' })
      await act(async () => { activeTool.value = 'select' })
      await act(async () => { activeTool.value = 'polygon' })
      expect(usedCanvasTools.value).toEqual(['polygon', 'select'])
    } finally {
      uninstall()
    }
  })

  it('lets View › Tool names pin the rail either way, whatever has been used', async () => {
    await mount()
    expect(toolRailShowsNames.value).toBe(true)
    await act(async () => { toggleToolNames() })
    expect(toolNamesVisible.value).toBe(false)
    expect(container.querySelector('[data-tool-rail="icons"]')).not.toBeNull()

    await act(async () => { usedCanvasTools.value = [...RAIL_TOOL_IDS] })
    await act(async () => { toggleToolNames() })
    expect(toolNamesVisible.value).toBe(true)
    expect(container.querySelector('[data-tool-rail="named"]')).not.toBeNull()
  })

  it('presses the active tool and groups tools as the Menus board does', async () => {
    activeTool.value = 'ellipse'
    await mount()
    const tools = [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
    expect(tools.map((button) => button.dataset.command)).toEqual([
      'canvas.tool.select', 'canvas.tool.hand',
      'canvas.tool.plantStamp', 'canvas.tool.plantSpacing', 'canvas.tool.objectStamp',
      'canvas.tool.polygon', 'canvas.tool.rectangle', 'canvas.tool.ellipse', 'canvas.tool.line',
      'canvas.tool.text', 'canvas.tool.measurementGuide',
    ])
    expect(tools.filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.dataset.command))
      .toEqual(['canvas.tool.ellipse'])
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(4)
  })

  it('selects a tool on click and keeps an open side panel', async () => {
    sidePanel.value = 'plant-db'
    await mount()
    await act(async () => { railButton('canvas.tool.line').click() })
    expect(setTool).toHaveBeenCalledWith('line')
    expect(activeTool.value).toBe('line')
    expect(sidePanel.value).toBe('plant-db')
    expect(activePanel.value).toBe('canvas')
  })

  it('moves focus with the arrow keys without choosing a tool (one tab stop)', async () => {
    await mount()
    const tabStops = [...container.querySelectorAll<HTMLButtonElement>('[data-rail-item]')].filter((button) => button.tabIndex === 0)
    expect(tabStops.map((button) => button.dataset.command)).toEqual(['canvas.tool.select'])

    railButton('canvas.tool.select').focus()
    await act(async () => {
      railButton('canvas.tool.select').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(railButton('canvas.tool.hand'))
    expect(railButton('canvas.tool.hand').tabIndex).toBe(0)
    expect(setTool).not.toHaveBeenCalled()

    await act(async () => {
      railButton('canvas.tool.hand').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    expect(document.activeElement).toBe(railButton('edit.redo'))
  })

  it('runs undo and redo from the rail only while history allows it', async () => {
    await mount()
    expect(railButton('edit.undo').getAttribute('aria-disabled')).toBe('true')
    railButton('edit.undo').click()
    expect(undo).not.toHaveBeenCalled()

    await act(async () => {
      canUndo.value = true
      canRedo.value = true
    })
    railButton('edit.undo').click()
    railButton('edit.redo').click()
    expect(undo).toHaveBeenCalledOnce()
    expect(redo).toHaveBeenCalledOnce()
  })

  it('offers plant color and symbol only while plants are selected', async () => {
    await mount()
    expect(container.querySelector('button[aria-label="Plant color"]')).toBeNull()

    await act(async () => {
      usedCanvasTools.value = [...RAIL_TOOL_IDS]
      selectedObjectIds.value = new Set(['plant-1'])
    })
    const color = container.querySelector<HTMLButtonElement>('button[aria-label="Plant color"]')!
    const symbol = container.querySelector<HTMLButtonElement>('button[aria-label="Plant symbol"]')!
    expect(color).not.toBeNull()

    await act(async () => { color.click() })
    expect(plantColorMenuOpen.value).toBe(true)
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()

    await act(async () => { symbol.click() })
    expect(plantColorMenuOpen.value).toBe(false)
    expect(plantSymbolMenuOpen.value).toBe(true)
    expect(document.body.querySelector('[role="dialog"][aria-label="Plant symbol"]')).not.toBeNull()

    await act(async () => { selectedObjectIds.value = new Set() })
    expect(plantSymbolMenuOpen.value).toBe(false)
  })
})

describe('ViewChip', () => {
  let container: HTMLDivElement
  const toggleGrid = vi.fn()
  const toggleSnapToGrid = vi.fn()
  const toggleRulers = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    gridVisible.value = false
    snapToGridEnabled.value = true
    rulersVisible.value = false
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({ chrome: { toggleGrid, toggleSnapToGrid, toggleRulers } }),
    }))
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    setCurrentCanvasSession(null)
  })

  it('shows Grid, Snap to grid and Rulers as pressed toggles with a check when on', async () => {
    await act(async () => { render(<Chip />, container) })
    const toggles = [...container.querySelectorAll<HTMLButtonElement>('button')]
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('View')
    expect(toggles.map((button) => [button.textContent, button.getAttribute('aria-pressed')])).toEqual([
      ['Grid', 'false'],
      ['Snap to grid', 'true'],
      ['Rulers', 'false'],
    ])
    expect(toggles.map((button) => button.querySelector('svg') !== null)).toEqual([false, true, false])
    expect(toggles[0]!.getAttribute('aria-keyshortcuts')).toBe('Shift+G')

    toggles.forEach((button) => button.click())
    expect(toggleGrid).toHaveBeenCalledOnce()
    expect(toggleSnapToGrid).toHaveBeenCalledOnce()
    expect(toggleRulers).toHaveBeenCalledOnce()

    await act(async () => { gridVisible.value = true })
    expect(toggles[0]!.getAttribute('aria-pressed')).toBe('true')
    expect(toggles[0]!.querySelector('svg')).not.toBeNull()
  })
})
