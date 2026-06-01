import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeTool } from '../canvas/session-state'
import { activePanel, sidePanel } from '../app/shell/state'
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
import { commands, getMenuDefinitions } from '../commands/registry'
import { PANEL_SHORTCUTS, TOOL_SHORTCUTS } from '../shortcuts/definitions'

function getCommand(id: string) {
  const command = commands.find((entry) => entry.id === id)
  if (!command) throw new Error(`Missing command ${id}`)
  return command
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
    problemReportDialogOpen.value = false
    resetFrontendDiagnosticsForTests()
  })

  it('routes tool commands through the live canvas session when mounted', () => {
    const setTool = vi.fn()
    setCurrentCanvasSession({
      setTool,
    } as any)

    getCommand('canvas.tool.hand').action()

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe(null)
    expect(setTool).toHaveBeenCalledWith('hand')
    expect(activeTool.value).toBe('hand')
  })

  it('exposes the ellipse tool through the shared command graph', () => {
    const setTool = vi.fn()
    setCurrentCanvasSession({
      setTool,
    } as any)

    getCommand('canvas.tool.ellipse').action()

    expect(getCommand('canvas.tool.ellipse').shortcut).toBe('E')
    expect(activePanel.value).toBe('canvas')
    expect(setTool).toHaveBeenCalledWith('ellipse')
    expect(activeTool.value).toBe('ellipse')
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
