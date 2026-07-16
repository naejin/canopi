import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signal } from '@preact/signals'
import { activeTool, selectedObjectIds } from '../canvas/session-state'
import { activePanel, sidePanel } from '../app/shell/state'
import * as documentActions from '../app/document-session/actions'
import { commandPaletteOpen, initShortcuts } from '../shortcuts/manager'
import { setCurrentCanvasSession } from '../canvas/session'
import { designSessionFixture } from './support/design-session-state'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

function mountCanvasCommandSurface(overrides: Parameters<typeof createTestCanvasCommandSurface>[0]): void {
  setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
    commands: createTestCanvasCommandSurface(overrides),
  }))
}

describe('shortcut manager canvas tool switching', () => {
  beforeEach(() => {
    activePanel.value = 'canvas'
    sidePanel.value = null
    activeTool.value = 'select'
    selectedObjectIds.value = new Set()
    setCurrentCanvasSession(null)
    designSessionFixture.file = null
    designSessionFixture.nonCanvasRevision = 0
    designSessionFixture.nonCanvasSavedRevision = 0
    commandPaletteOpen.value = false
    initShortcuts()
  })

  afterEach(() => {
    setCurrentCanvasSession(null)
    activeTool.value = 'select'
    selectedObjectIds.value = new Set()
    designSessionFixture.file = null
    commandPaletteOpen.value = false
  })

  it('routes tool shortcuts through the live canvas session when mounted', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ tools: { setTool } })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))

    expect(setTool).toHaveBeenCalledWith('rectangle')
    expect(activeTool.value).toBe('rectangle')
  })

  it('routes the ellipse tool shortcut through the live canvas session', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ tools: { setTool } })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }))

    expect(setTool).toHaveBeenCalledWith('ellipse')
    expect(activeTool.value).toBe('ellipse')
  })

  it('routes the Line tool shortcut through the live canvas session', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ tools: { setTool } })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }))

    expect(setTool).toHaveBeenCalledWith('line')
    expect(activeTool.value).toBe('line')
  })

  it('routes the polygon tool shortcut through the live canvas session', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ tools: { setTool } })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }))

    expect(setTool).toHaveBeenCalledWith('polygon')
    expect(activeTool.value).toBe('polygon')
  })

  it('routes the Plant Spacing shortcut through the live canvas session', () => {
    const setTool = vi.fn()
    mountCanvasCommandSurface({ tools: { setTool } })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }))

    expect(setTool).toHaveBeenCalledWith('plant-spacing')
    expect(activeTool.value).toBe('plant-spacing')
  })

  it('does not route tool shortcuts while an editable input is focused', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    const setTool = vi.fn()
    mountCanvasCommandSurface({ tools: { setTool } })

    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))

    expect(setTool).not.toHaveBeenCalled()
    expect(activeTool.value).toBe('select')
    input.remove()
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

  it('preserves bare panel shortcuts outside editable controls', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }))

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))

    expect(sidePanel.value).toBe('plant-db')
    input.remove()
  })

  it('toggles and closes the command palette through the keyboard seam', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true }))

    expect(commandPaletteOpen.value).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(commandPaletteOpen.value).toBe(false)
  })

  it('routes file shortcuts through document-session actions', () => {
    designSessionFixture.file = {
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
    designSessionFixture.nonCanvasRevision = 1
    designSessionFixture.nonCanvasSavedRevision = 0
    const saveSpy = vi.spyOn(documentActions, 'saveCurrentDesign').mockResolvedValue(null)
    const saveAsSpy = vi.spyOn(documentActions, 'saveAsCurrentDesign').mockResolvedValue(null)
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

  it('routes view and history shortcuts through the App Command Graph adapter', () => {
    const zoomIn = vi.fn()
    const zoomOut = vi.fn()
    const zoomToFit = vi.fn()
    const undo = vi.fn()
    const redo = vi.fn()
    mountCanvasCommandSurface({
      viewport: {
        zoomIn,
        zoomOut,
        zoomToFit,
      },
      history: {
        canUndo: signal(true),
        canRedo: signal(true),
        undo,
        redo,
      },
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true }))

    expect(zoomIn).toHaveBeenCalledTimes(1)
    expect(zoomOut).toHaveBeenCalledTimes(1)
    expect(zoomToFit).toHaveBeenCalledTimes(1)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(1)
  })

  it('routes canvas edit, ordering, lock, and grouping shortcuts through the App Command Graph adapter', () => {
    const copy = vi.fn()
    const paste = vi.fn()
    const duplicateSelected = vi.fn()
    const deleteSelected = vi.fn()
    const selectAll = vi.fn()
    const bringToFront = vi.fn()
    const sendToBack = vi.fn()
    const lockSelected = vi.fn()
    const unlockSelected = vi.fn()
    const groupSelected = vi.fn()
    const ungroupSelected = vi.fn()
    mountCanvasCommandSurface({
      sceneEdits: {
        copy,
        paste,
        duplicateSelected,
        deleteSelected,
        selectAll,
        bringToFront,
        sendToBack,
        lockSelected,
        unlockSelected,
        groupSelected,
        ungroupSelected,
      },
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ']' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '[' }))
    selectedObjectIds.value = new Set(['plant-1'])
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true }))
    selectedObjectIds.value = new Set()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'G', ctrlKey: true, shiftKey: true }))

    expect(copy).toHaveBeenCalledTimes(1)
    expect(paste).toHaveBeenCalledTimes(1)
    expect(duplicateSelected).toHaveBeenCalledTimes(1)
    expect(deleteSelected).toHaveBeenCalledTimes(1)
    expect(selectAll).toHaveBeenCalledTimes(1)
    expect(bringToFront).toHaveBeenCalledTimes(1)
    expect(sendToBack).toHaveBeenCalledTimes(1)
    expect(lockSelected).toHaveBeenCalledTimes(1)
    expect(unlockSelected).not.toHaveBeenCalled()
    expect(groupSelected).toHaveBeenCalledTimes(1)
    expect(ungroupSelected).toHaveBeenCalledTimes(1)
  })
})
