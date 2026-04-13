import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeTool } from '../state/canvas'
import { activePanel, sidePanel } from '../app/shell/state'
import { initShortcuts } from '../shortcuts/manager'
import { setCurrentCanvasSession } from '../canvas/session'

describe('shortcut manager canvas tool switching', () => {
  beforeEach(() => {
    activePanel.value = 'canvas'
    sidePanel.value = null
    activeTool.value = 'select'
    setCurrentCanvasSession(null)
    initShortcuts()
  })

  afterEach(() => {
    setCurrentCanvasSession(null)
    activeTool.value = 'select'
  })

  it('routes tool shortcuts through the live canvas session when mounted', () => {
    const setTool = vi.fn()
    setCurrentCanvasSession({
      setTool,
    } as any)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))

    expect(setTool).toHaveBeenCalledWith('rectangle')
    expect(activeTool.value).toBe('rectangle')
  })

  it('falls back to priming the mirror tool state before session mount', () => {
    setCurrentCanvasSession(null)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }))

    expect(activeTool.value).toBe('text')
  })

  it('keeps panel shortcuts aligned with the command registry mapping', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true }))

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true }))

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe(null)
  })
})
