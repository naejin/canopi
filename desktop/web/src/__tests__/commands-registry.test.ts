import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeTool } from '../state/canvas'
import { activePanel, sidePanel } from '../state/app'
import { setCurrentCanvasSession } from '../canvas/session'
import { commands } from '../commands/registry'
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
  })

  afterEach(() => {
    setCurrentCanvasSession(null)
    activeTool.value = 'select'
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
})
