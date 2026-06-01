import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeTool } from '../canvas/session-state'
import { activePanel, sidePanel } from '../app/shell/state'
import * as documentActions from '../app/document-session/actions'
import { initShortcuts } from '../shortcuts/manager'
import { setCurrentCanvasSession } from '../canvas/session'
import { currentDesign, nonCanvasRevision, nonCanvasSavedRevision } from './support/design-session-state'

describe('shortcut manager canvas tool switching', () => {
  beforeEach(() => {
    activePanel.value = 'canvas'
    sidePanel.value = null
    activeTool.value = 'select'
    setCurrentCanvasSession(null)
    currentDesign.value = null
    nonCanvasRevision.value = 0
    nonCanvasSavedRevision.value = 0
    initShortcuts()
  })

  afterEach(() => {
    setCurrentCanvasSession(null)
    activeTool.value = 'select'
    currentDesign.value = null
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

  it('routes the ellipse tool shortcut through the live canvas session', () => {
    const setTool = vi.fn()
    setCurrentCanvasSession({
      setTool,
    } as any)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }))

    expect(setTool).toHaveBeenCalledWith('ellipse')
    expect(activeTool.value).toBe('ellipse')
  })

  it('routes the polygon tool shortcut through the live canvas session', () => {
    const setTool = vi.fn()
    setCurrentCanvasSession({
      setTool,
    } as any)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }))

    expect(setTool).toHaveBeenCalledWith('polygon')
    expect(activeTool.value).toBe('polygon')
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

  it('routes file shortcuts through document-session actions', () => {
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
    const saveSpy = vi.spyOn(documentActions, 'saveCurrentDesign').mockResolvedValue(undefined)
    const saveAsSpy = vi.spyOn(documentActions, 'saveAsCurrentDesign').mockResolvedValue(undefined)
    const openSpy = vi.spyOn(documentActions, 'openDesign').mockResolvedValue(undefined)
    const newSpy = vi.spyOn(documentActions, 'newDesignAction').mockResolvedValue(undefined)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', ctrlKey: true, shiftKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }))

    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(saveAsSpy).toHaveBeenCalledTimes(1)
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(newSpy).toHaveBeenCalledTimes(1)
  })
})
