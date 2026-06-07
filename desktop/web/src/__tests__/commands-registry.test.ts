import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signal } from '@preact/signals'
import { activeTool } from '../canvas/session-state'
import { activePanel, sidePanel } from '../app/shell/state'
import {
  gridVisible,
  rulersVisible,
  snapToGridEnabled,
} from '../app/canvas-settings/signals'
import { theme } from '../app/settings/state'
import { setCurrentCanvasSession } from '../canvas/session'
import { currentDesign, nonCanvasRevision, nonCanvasSavedRevision } from './support/design-session-state'
import * as documentActions from '../app/document-session/actions'
import { problemReportDialogOpen } from '../app/problem-report/state'
import {
  recentFrontendDiagnostics,
  resetFrontendDiagnosticsForTests,
} from '../app/problem-report/diagnostics'
import * as settingsProjection from '../app/settings/projection'
import {
  appCommandGraphChromeProjection,
  appCommandGraphPanelProjection,
  appCommandGraphToolbarProjection,
  commands,
  getMenuDefinitions,
  runAppCommand,
} from '../commands/registry'
import { EDIT_SHORTCUTS, PANEL_SHORTCUTS, TOOL_SHORTCUTS } from '../shortcuts/definitions'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

function getCommand(id: string) {
  const command = commands.find((entry) => entry.id === id)
  if (!command) throw new Error(`Missing command ${id}`)
  return command
}

function mountCanvasCommandSurface(overrides: Parameters<typeof createTestCanvasCommandSurface>[0]): void {
  setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
    commands: createTestCanvasCommandSurface(overrides),
  }))
}

describe('command registry canvas tool switching', () => {
  beforeEach(() => {
    activeTool.value = 'select'
    activePanel.value = 'canvas'
    sidePanel.value = null
    setCurrentCanvasSession(null)
    currentDesign.value = null
    nonCanvasRevision.value = 0
    nonCanvasSavedRevision.value = 0
    gridVisible.value = true
    snapToGridEnabled.value = false
    rulersVisible.value = true
    settingsProjection.resetSettingsProjectionForTests()
    problemReportDialogOpen.value = false
    resetFrontendDiagnosticsForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setCurrentCanvasSession(null)
    activeTool.value = 'select'
    currentDesign.value = null
    theme.value = 'light'
    gridVisible.value = true
    snapToGridEnabled.value = false
    rulersVisible.value = true
    problemReportDialogOpen.value = false
    resetFrontendDiagnosticsForTests()
  })

  it('routes tool commands through the live canvas session when mounted', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ setTool })

    getCommand('canvas.tool.hand').action()

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe(null)
    expect(setTool).toHaveBeenCalledWith('hand')
    expect(activeTool.value).toBe('hand')
  })

  it('preserves side panels only when tool commands already start from the canvas', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ setTool })

    sidePanel.value = 'plant-db'
    getCommand('canvas.tool.ellipse').action()

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')
    expect(setTool).toHaveBeenCalledWith('ellipse')
    expect(activeTool.value).toBe('ellipse')

    activePanel.value = 'location'
    sidePanel.value = null
    getCommand('canvas.tool.hand').action()

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe(null)
    expect(setTool).toHaveBeenCalledWith('hand')
    expect(activeTool.value).toBe('hand')
  })

  it('exposes the ellipse tool through the shared command graph', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ setTool })

    getCommand('canvas.tool.ellipse').action()

    expect(getCommand('canvas.tool.ellipse').shortcut).toBe('E')
    expect(activePanel.value).toBe('canvas')
    expect(setTool).toHaveBeenCalledWith('ellipse')
    expect(activeTool.value).toBe('ellipse')
  })

  it('exposes the polygon tool through the shared command graph', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ setTool })

    getCommand('canvas.tool.polygon').action()

    expect(getCommand('canvas.tool.polygon').shortcut).toBe('P')
    expect(activePanel.value).toBe('canvas')
    expect(setTool).toHaveBeenCalledWith('polygon')
    expect(activeTool.value).toBe('polygon')
  })

  it('exposes Object Stamp through the shared command graph', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ setTool })

    getCommand('canvas.tool.objectStamp').action()

    expect(activePanel.value).toBe('canvas')
    expect(setTool).toHaveBeenCalledWith('object-stamp')
    expect(activeTool.value).toBe('object-stamp')
  })

  it('exposes Plant Spacing through the shared command graph', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ setTool })

    getCommand('canvas.tool.plantSpacing').action()

    expect(getCommand('canvas.tool.plantSpacing').shortcut).toBe('S')
    expect(activePanel.value).toBe('canvas')
    expect(setTool).toHaveBeenCalledWith('plant-spacing')
    expect(activeTool.value).toBe('plant-spacing')
  })

  it('falls back to priming the mirror tool state when no session is mounted', () => {
    getCommand('canvas.tool.text').action()

    expect(activePanel.value).toBe('canvas')
    expect(activeTool.value).toBe('text')
  })

  it('uses the shared shortcut definitions for panel navigation and tools', () => {
    expect(getCommand('nav.canvas').shortcut).toBe(PANEL_SHORTCUTS.canvas)
    expect(getCommand('nav.plantDb').shortcut).toBe(PANEL_SHORTCUTS.plantDb)
    expect(getCommand('nav.location').shortcut).toBeUndefined()
    expect(getCommand('canvas.tool.select').shortcut).toBe(TOOL_SHORTCUTS.select)
    expect(getCommand('canvas.tool.text').shortcut).toBe(TOOL_SHORTCUTS.text)
  })

  it('routes file commands through document-session actions', () => {
    currentDesign.value = {
      version: 2,
      name: 'test',
      description: null,
      location: null,
      north_bearing_deg: null,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      budget_currency: 'EUR',
      created_at: '',
      updated_at: '',
      extra: {},
    }
    nonCanvasRevision.value = 1
    nonCanvasSavedRevision.value = 0
    const newSpy = vi.spyOn(documentActions, 'newDesignAction').mockResolvedValue(undefined)
    const openSpy = vi.spyOn(documentActions, 'openDesign').mockResolvedValue(undefined)
    const saveSpy = vi.spyOn(documentActions, 'saveCurrentDesign').mockResolvedValue(undefined)
    const saveAsSpy = vi.spyOn(documentActions, 'saveAsCurrentDesign').mockResolvedValue(undefined)

    getCommand('file.new').action()
    getCommand('file.open').action()
    getCommand('file.save').action()
    getCommand('file.saveAs').action()

    expect(newSpy).toHaveBeenCalledTimes(1)
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(saveAsSpy).toHaveBeenCalledTimes(1)
  })

  it('projects menu entries from the same command graph', () => {
    const menus = getMenuDefinitions()
    const commandIds = new Set(commands.map((command) => command.id))
    const menuCommandIds = menus
      .flatMap((menu) => menu.items)
      .flatMap((entry) => entry.type === 'action' ? [entry.id] : [])

    expect(menuCommandIds).toContain('file.save')
    expect(menuCommandIds).toContain('edit.undo')
    expect(menuCommandIds).toContain('view.zoomIn')
    expect(commandIds.has('file.save')).toBe(true)
    expect(commandIds.has('view.zoomIn')).toBe(true)
  })

  it('exposes reactive chrome projections from the App Command Graph', () => {
    const fileSave = () => appCommandGraphChromeProjection.value.menus
      .find((menu) => menu.id === 'file')!
      .items.find((entry) => entry.type === 'action' && entry.id === 'file.save')
    const undo = () => appCommandGraphChromeProjection.value.menus
      .find((menu) => menu.id === 'edit')!
      .items.find((entry) => entry.type === 'action' && entry.id === 'edit.undo')
    const zoomIn = () => appCommandGraphChromeProjection.value.paletteCommands
      .find((entry) => entry.id === 'view.zoomIn')!

    expect(fileSave()).toMatchObject({ disabled: true })
    expect(undo()).toMatchObject({ disabled: true })
    expect(zoomIn().disabled()).toBe(true)

    currentDesign.value = {
      version: 2,
      name: 'test',
      description: null,
      location: null,
      north_bearing_deg: null,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      budget_currency: 'EUR',
      created_at: '',
      updated_at: '',
      extra: {},
    }
    nonCanvasRevision.value = 1
    nonCanvasSavedRevision.value = 0
    mountCanvasCommandSurface({ canUndo: signal(true) })

    expect(fileSave()).toMatchObject({ disabled: false })
    expect(undo()).toMatchObject({ disabled: false })
    expect(zoomIn().disabled()).toBe(false)
  })

  it('exposes panel navigation through the App Command Graph', () => {
    const panelCommand = (id: string) => [
      ...appCommandGraphPanelProjection.value.primary,
      ...appCommandGraphPanelProjection.value.side,
    ].find((entry) => entry.panel === id)!

    expect(panelCommand('canvas')).toMatchObject({
      commandId: 'nav.canvas',
      disabled: false,
      active: true,
    })
    expect(panelCommand('location')).toMatchObject({
      commandId: 'nav.location',
      disabled: true,
      active: false,
    })
    expect(panelCommand('plant-db')).toMatchObject({
      commandId: 'nav.plantDb',
      disabled: true,
      active: false,
    })
    expect(panelCommand('favorites')).toMatchObject({
      commandId: 'nav.favorites',
      disabled: true,
      active: false,
    })
    expect(runAppCommand('nav.plantDb')).toBe(true)
    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')
    expect(panelCommand('plant-db')).toMatchObject({ disabled: false, active: true })
    expect(runAppCommand('nav.plantDb')).toBe(true)
    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe(null)

    currentDesign.value = {
      version: 2,
      name: 'test',
      description: null,
      location: null,
      north_bearing_deg: null,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      budget_currency: 'EUR',
      created_at: '',
      updated_at: '',
      extra: {},
    }

    expect(panelCommand('plant-db')).toMatchObject({ disabled: false, active: false })
    expect(runAppCommand('nav.plantDb')).toBe(true)
    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')
    expect(panelCommand('plant-db')).toMatchObject({ disabled: false, active: true })

    expect(runAppCommand('nav.plantDb')).toBe(true)
    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe(null)
  })

  it('exposes toolbar commands through the App Command Graph', () => {
    const setTool = vi.fn()
    const undo = vi.fn()
    const toggleGrid = vi.fn()
    const toggleSnapToGrid = vi.fn()
    const toggleRulers = vi.fn()

    const primaryTool = (tool: string) => appCommandGraphToolbarProjection.value.primaryTools
      .find((entry) => entry.tool === tool)!
    const shapeTool = (tool: string) => appCommandGraphToolbarProjection.value.shapeTools
      .find((entry) => entry.tool === tool)!
    const historyAction = (id: string) => appCommandGraphToolbarProjection.value.historyActions
      .find((entry) => entry.id === id)!
    const settingToggle = (id: string) => appCommandGraphToolbarProjection.value.settingsToggles
      .find((entry) => entry.id === id)!

    expect(primaryTool('select')).toMatchObject({
      commandId: 'canvas.tool.select',
      active: true,
      disabled: false,
      shortcut: TOOL_SHORTCUTS.select,
    })
    expect(shapeTool('ellipse')).toMatchObject({
      commandId: 'canvas.tool.ellipse',
      active: false,
      disabled: false,
      shortcut: TOOL_SHORTCUTS.ellipse,
    })
    expect(historyAction('undo')).toMatchObject({
      commandId: 'edit.undo',
      disabled: true,
      shortcut: EDIT_SHORTCUTS.undo,
    })
    expect(settingToggle('grid')).toMatchObject({
      commandId: 'canvas.toggleGrid',
      disabled: true,
      pressed: true,
    })
    expect(settingToggle('snap')).toMatchObject({
      commandId: 'canvas.toggleSnapToGrid',
      disabled: true,
      pressed: false,
    })
    expect(settingToggle('rulers')).toMatchObject({
      commandId: 'canvas.toggleRulers',
      disabled: true,
      pressed: true,
    })

    mountCanvasCommandSurface({
      canUndo: signal(true),
      setTool,
      undo,
      toggleGrid,
      toggleSnapToGrid,
      toggleRulers,
    })
    snapToGridEnabled.value = true

    expect(historyAction('undo')).toMatchObject({ disabled: false })
    expect(settingToggle('grid')).toMatchObject({ disabled: false, pressed: true })
    expect(settingToggle('snap')).toMatchObject({ disabled: false, pressed: true })

    shapeTool('ellipse').action()
    historyAction('undo').action()
    settingToggle('grid').action()
    settingToggle('snap').action()
    settingToggle('rulers').action()

    expect(activePanel.value).toBe('canvas')
    expect(setTool).toHaveBeenCalledWith('ellipse')
    expect(activeTool.value).toBe('ellipse')
    expect(undo).toHaveBeenCalledTimes(1)
    expect(toggleGrid).toHaveBeenCalledTimes(1)
    expect(toggleSnapToGrid).toHaveBeenCalledTimes(1)
    expect(toggleRulers).toHaveBeenCalledTimes(1)
  })

  it('toggles theme through the settings projection seam', () => {
    theme.value = 'light'
    const mutateSpy = vi.spyOn(settingsProjection, 'mutateSettingsProjection')

    getCommand('view.toggleTheme').action()

    expect(theme.value).toBe('dark')
    expect(mutateSpy).toHaveBeenCalledWith(expect.any(Function), { persist: 'immediate' })
  })

  it('opens problem reporting from the shared command graph', () => {
    getCommand('help.reportProblem').action()

    expect(problemReportDialogOpen.value).toBe(true)

    const help = getMenuDefinitions().find((menu) => menu.id === 'help')
    expect(help?.items.some((entry) => entry.type === 'action' && entry.id === 'help.reportProblem')).toBe(true)
  })

  it('records async command failures for Problem Reports', async () => {
    vi.spyOn(documentActions, 'newDesignAction').mockRejectedValue(new Error('disk failed at /home/alice/design.canopi'))

    getCommand('file.new').action()
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0))

    expect(recentFrontendDiagnostics()).toEqual([
      expect.objectContaining({
        level: 'error',
        source: 'command:New design',
        message: expect.stringContaining('disk failed'),
      }),
    ])
    expect(recentFrontendDiagnostics()[0]!.message).not.toContain('/home/alice')
  })
})
