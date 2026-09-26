import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
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
import { designSessionFixture, resetDirtyBaselines } from './support/design-session-state'
import * as documentActions from '../app/document-session/actions'
import { problemReportDialogOpen } from '../app/problem-report/state'
import { answerSaveProblem, requestSaveProblemDecision } from '../app/document-session/save-problem'
import {
  recentFrontendDiagnostics,
  resetFrontendDiagnosticsForTests,
} from '../app/problem-report/diagnostics'
import * as settingsProjection from '../app/settings/projection'
import {
  appCommandGraphChromeProjection,
  appCommandGraphPanelProjection,
  appCommandGraphToolbarProjection,
  commandPaletteOpen,
  handleAppCommandKeyDown,
} from '../commands/registry'
import type { AppCommandId } from '../commands/graph/catalog'
import { CANVAS_HISTORY_SHORTCUTS, CANVAS_TOOL_SHORTCUTS } from '../app/canvas-commands'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

function paletteCommands() {
  return appCommandGraphChromeProjection.value.paletteCommands
}

function menus() {
  return appCommandGraphChromeProjection.value.menus
}

function runPanelCommand(commandId: string): void {
  const projection = appCommandGraphPanelProjection.value
  const command = [...projection.primary, ...projection.design, ...projection.side]
    .find((entry) => entry.commandId === commandId)
  if (!command) throw new Error(`Missing panel command ${commandId}`)
  command.action()
}

function getCommand(id: string) {
  const command = paletteCommands().find((entry) => entry.id === id)
  if (!command) throw new Error(`Missing command ${id}`)
  return command
}

function mountCanvasCommandSurface(overrides: Parameters<typeof createTestCanvasCommandSurface>[0]): void {
  setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
    commands: createTestCanvasCommandSurface(overrides),
  }))
}

describe('command registry canvas tool switching', () => {
  it('keeps Web-only file identities outside the Desktop command interface', () => {
    expectTypeOf<'file.openCanopi'>().not.toMatchTypeOf<AppCommandId>()
    expectTypeOf<'file.downloadCanopi'>().not.toMatchTypeOf<AppCommandId>()
  })

  beforeEach(() => {
    activeTool.value = 'select'
    activePanel.value = 'canvas'
    sidePanel.value = null
    setCurrentCanvasSession(null)
    designSessionFixture.file = null
    designSessionFixture.nonCanvasRevision = 0
    designSessionFixture.nonCanvasSavedRevision = 0
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
    designSessionFixture.file = null
    theme.value = 'light'
    gridVisible.value = true
    snapToGridEnabled.value = false
    rulersVisible.value = true
    problemReportDialogOpen.value = false
    resetFrontendDiagnosticsForTests()
  })

  it('routes tool commands through the live canvas session when mounted', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ tools: { setTool } })

    getCommand('canvas.tool.hand').action()

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe(null)
    expect(setTool).toHaveBeenCalledWith('hand')
    expect(activeTool.value).toBe('hand')
  })

  it('preserves side panels only when tool commands already start from the canvas', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ tools: { setTool } })

    sidePanel.value = 'plant-db'
    getCommand('canvas.tool.ellipse').action()

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')
    expect(setTool).toHaveBeenCalledWith('ellipse')
    expect(activeTool.value).toBe('ellipse')

    activePanel.value = 'templates'
    sidePanel.value = null
    getCommand('canvas.tool.hand').action()

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe(null)
    expect(setTool).toHaveBeenCalledWith('hand')
    expect(activeTool.value).toBe('hand')
  })

  it('exposes the ellipse tool through the shared command graph', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ tools: { setTool } })

    getCommand('canvas.tool.ellipse').action()

    expect(getCommand('canvas.tool.ellipse').shortcut).toBe('E')
    expect(activePanel.value).toBe('canvas')
    expect(setTool).toHaveBeenCalledWith('ellipse')
    expect(activeTool.value).toBe('ellipse')
  })

  it('exposes the polygon tool through the shared command graph', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ tools: { setTool } })

    getCommand('canvas.tool.polygon').action()

    expect(getCommand('canvas.tool.polygon').shortcut).toBe('P')
    expect(activePanel.value).toBe('canvas')
    expect(setTool).toHaveBeenCalledWith('polygon')
    expect(activeTool.value).toBe('polygon')
  })

  it('exposes the Line tool through the shared command graph', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ tools: { setTool } })

    getCommand('canvas.tool.line').action()

    expect(getCommand('canvas.tool.line').shortcut).toBe('L')
    expect(activePanel.value).toBe('canvas')
    expect(setTool).toHaveBeenCalledWith('line')
    expect(activeTool.value).toBe('line')
  })

  it('exposes the Measurement Guide tool through the shared command graph', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ tools: { setTool } })

    getCommand('canvas.tool.measurementGuide').action()

    expect(activePanel.value).toBe('canvas')
    expect(setTool).toHaveBeenCalledWith('measurement-guide')
    expect(activeTool.value).toBe('measurement-guide')
    expect(appCommandGraphToolbarProjection.value.creationTools.some((tool) =>
      tool.tool === 'measurement-guide'
      && tool.commandId === 'canvas.tool.measurementGuide',
    )).toBe(true)
  })

  it('exposes Object Stamp through the shared command graph', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ tools: { setTool } })

    getCommand('canvas.tool.objectStamp').action()

    expect(activePanel.value).toBe('canvas')
    expect(setTool).toHaveBeenCalledWith('object-stamp')
    expect(activeTool.value).toBe('object-stamp')
  })

  it('exposes Plant Spacing through the shared command graph', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ tools: { setTool } })

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
    expect(getCommand('nav.canvas').shortcut).toBe('Ctrl+1')
    expect(getCommand('nav.plantDb').shortcut).toBe('Ctrl+2')
    expect(getCommand('nav.designNotebook').shortcut).toBeUndefined()
    expect(getCommand('canvas.tool.select').shortcut).toBe(CANVAS_TOOL_SHORTCUTS.select)
    expect(getCommand('canvas.tool.line').shortcut).toBe(CANVAS_TOOL_SHORTCUTS.line)
    expect(getCommand('canvas.tool.text').shortcut).toBe(CANVAS_TOOL_SHORTCUTS.text)
  })

  it('routes file commands through document-session actions', () => {
    designSessionFixture.file = {
      version: 7,
      name: 'test',
      description: null,
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
    designSessionFixture.nonCanvasRevision = 1
    designSessionFixture.nonCanvasSavedRevision = 0
    const newSpy = vi.spyOn(documentActions, 'newDesignAction').mockResolvedValue(undefined)
    const openSpy = vi.spyOn(documentActions, 'openDesign').mockResolvedValue(undefined)
    const saveSpy = vi.spyOn(documentActions, 'saveCurrentDesign').mockResolvedValue(true)
    const saveAsSpy = vi.spyOn(documentActions, 'saveAsCurrentDesign').mockResolvedValue(null)

    getCommand('file.new').action()
    getCommand('file.open').action()
    getCommand('file.save').action()
    getCommand('file.saveAs').action()

    expect(newSpy).toHaveBeenCalledTimes(1)
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(saveAsSpy).toHaveBeenCalledTimes(1)
  })

  it('does not expose Design Report PDF export from the command graph', () => {
    expect(paletteCommands().some((command) => String(command.id) === 'file.exportDesignReportPdf')).toBe(false)
    expect(menus().some((menu) =>
      menu.items.some((entry) => entry.type === 'action' && entry.id === 'file.exportDesignReportPdf'),
    )).toBe(false)
  })

  it('enables Save for any open Design, clean or not', () => {
    const saveCommand = getCommand('file.save')
    const saveSpy = vi.spyOn(documentActions, 'saveCurrentDesign').mockResolvedValue(true)

    expect(saveCommand.disabled()).toBe(true)

    designSessionFixture.file = {
      version: 7,
      name: 'test',
      description: null,
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
    resetDirtyBaselines()

    expect(saveCommand.disabled()).toBe(false)

    saveCommand.action()

    expect(saveSpy).toHaveBeenCalledTimes(1)
  })

  it('projects menu entries from the same command graph', () => {
    const commandIds = new Set(paletteCommands().map((command) => command.id))
    const menuCommandIds = menus()
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

    designSessionFixture.file = {
      version: 7,
      name: 'test',
      description: null,
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
    designSessionFixture.nonCanvasRevision = 1
    designSessionFixture.nonCanvasSavedRevision = 0
    mountCanvasCommandSurface({ history: { canUndo: signal(true) } })

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
    expect(panelCommand('location')).toBeUndefined()
    expect(panelCommand('plant-db')).toMatchObject({
      commandId: 'nav.plantDb',
      disabled: true,
      active: false,
    })
    expect(panelCommand('design-notebook')).toMatchObject({
      commandId: 'nav.designNotebook',
      disabled: false,
      active: false,
    })
    expect(panelCommand('favorites')).toMatchObject({
      commandId: 'nav.favorites',
      disabled: true,
      active: false,
    })
    runPanelCommand('nav.designNotebook')
    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('design-notebook')
    expect(panelCommand('design-notebook')).toMatchObject({ disabled: false, active: true })
    runPanelCommand('nav.designNotebook')
    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe(null)

    runPanelCommand('nav.plantDb')
    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')
    expect(panelCommand('plant-db')).toMatchObject({ disabled: false, active: true })
    runPanelCommand('nav.plantDb')
    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe(null)

    designSessionFixture.file = {
      version: 7,
      name: 'test',
      description: null,
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
    runPanelCommand('nav.plantDb')
    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')
    expect(panelCommand('plant-db')).toMatchObject({ disabled: false, active: true })

    runPanelCommand('nav.plantDb')
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
    const creationTool = (tool: string) => appCommandGraphToolbarProjection.value.creationTools
      .find((entry) => entry.tool === tool)!
    const reuseTool = (tool: string) => appCommandGraphToolbarProjection.value.reuseTools
      .find((entry) => entry.tool === tool)!
    const historyAction = (id: string) => appCommandGraphToolbarProjection.value.historyActions
      .find((entry) => entry.id === id)!
    const settingToggle = (id: string) => appCommandGraphToolbarProjection.value.settingsToggles
      .find((entry) => entry.id === id)!

    expect(primaryTool('select')).toMatchObject({
      commandId: 'canvas.tool.select',
      active: true,
      disabled: false,
      shortcut: CANVAS_TOOL_SHORTCUTS.select,
    })
    expect(creationTool('line')).toMatchObject({
      commandId: 'canvas.tool.line',
      active: false,
      disabled: false,
      shortcut: CANVAS_TOOL_SHORTCUTS.line,
    })
    expect(creationTool('ellipse')).toMatchObject({
      commandId: 'canvas.tool.ellipse',
      active: false,
      disabled: false,
      shortcut: CANVAS_TOOL_SHORTCUTS.ellipse,
    })
    expect(reuseTool('plant-spacing')).toMatchObject({
      commandId: 'canvas.tool.plantSpacing',
      active: false,
      disabled: false,
      shortcut: CANVAS_TOOL_SHORTCUTS.plantSpacing,
    })
    expect(historyAction('undo')).toMatchObject({
      commandId: 'edit.undo',
      disabled: true,
      shortcut: CANVAS_HISTORY_SHORTCUTS.undo,
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
      tools: { setTool },
      history: {
        canUndo: signal(true),
        undo,
      },
      chrome: {
        toggleGrid,
        toggleSnapToGrid,
        toggleRulers,
      },
    })
    snapToGridEnabled.value = true

    expect(historyAction('undo')).toMatchObject({ disabled: false })
    expect(settingToggle('grid')).toMatchObject({ disabled: false, pressed: true })
    expect(settingToggle('snap')).toMatchObject({ disabled: false, pressed: true })

    creationTool('ellipse').action()
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

  it('re-acquires the live Canvas surface for retained toolbar actions', () => {
    const detachedUndo = vi.fn()
    const replacementUndo = vi.fn()
    mountCanvasCommandSurface({
      history: {
        canUndo: signal(true),
        undo: detachedUndo,
      },
    })
    const retainedUndo = appCommandGraphToolbarProjection.value.historyActions
      .find((entry) => entry.id === 'undo')!.action

    setCurrentCanvasSession(null)
    retainedUndo()

    expect(detachedUndo).not.toHaveBeenCalled()

    mountCanvasCommandSurface({
      history: {
        canUndo: signal(true),
        undo: replacementUndo,
      },
    })
    retainedUndo()

    expect(detachedUndo).not.toHaveBeenCalled()
    expect(replacementUndo).toHaveBeenCalledTimes(1)
  })

  it('leaves editable undo shortcuts to native text editing', () => {
    const undo = vi.fn()
    mountCanvasCommandSurface({
      history: {
        canUndo: signal(true),
        undo,
      },
    })
    const input = document.createElement('input')
    let handled = true
    input.addEventListener('keydown', (event) => {
      handled = handleAppCommandKeyDown(event)
    })
    document.body.append(input)

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    input.dispatchEvent(event)

    expect(handled).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(undo).not.toHaveBeenCalled()
    input.remove()
  })

  it('ignores app shortcuts and the palette while the save dialog is open', async () => {
    const openSpy = vi.spyOn(documentActions, 'openDesign').mockResolvedValue(undefined)
    const keyDown = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
      return { handled: handleAppCommandKeyDown(event), event }
    }
    const decision = requestSaveProblemDecision({ kind: 'revert' })

    const open = keyDown({ key: 'o', ctrlKey: true })
    const palette = keyDown({ key: 'P', ctrlKey: true, shiftKey: true })

    expect(open.handled).toBe(false)
    expect(open.event.defaultPrevented).toBe(false)
    expect(palette.handled).toBe(false)
    expect(commandPaletteOpen.value).toBe(false)
    expect(openSpy).not.toHaveBeenCalled()

    answerSaveProblem('cancel')
    await expect(decision).resolves.toBe('cancel')
    expect(keyDown({ key: 'o', ctrlKey: true }).handled).toBe(true)
    expect(openSpy).toHaveBeenCalledOnce()
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

    const help = menus().find((menu) => menu.id === 'help')
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
