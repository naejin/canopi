import { describe, expect, it, vi } from 'vitest'
import {
  canvasCommandIdForShortcut,
  createCanvasCommandProjection,
  projectedCanvasTools,
  type CanvasCommandIntentAdapter,
  type CanvasCommandProjectionState,
} from '../app/canvas-commands'
import { ariaKeyShortcuts, formatShortcut } from '../app/shell-commands/shortcut-text'

function intentAdapter(): CanvasCommandIntentAdapter {
  return {
    selectTool: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    toggleGrid: vi.fn(),
    toggleSnapToGrid: vi.fn(),
    toggleRulers: vi.fn(),
    edit: vi.fn(),
    view: vi.fn(),
  }
}

function state(overrides: Partial<CanvasCommandProjectionState> = {}): CanvasCommandProjectionState {
  return {
    activeTool: 'select',
    canvasAvailable: true,
    toolSelectionAvailable: true,
    spatialEditingAvailable: true,
    hasSelection: false,
    sameSpeciesSelectionAvailable: false,
    canUndo: false,
    canRedo: false,
    settingsAvailable: true,
    gridVisible: false,
    snapToGridEnabled: true,
    rulersVisible: false,
    ...overrides,
  }
}

const KEY_NAMES: Record<string, string> = {
  'shortcutKeys.ctrl': 'Ctrl',
  'shortcutKeys.shift': 'Shift',
  'shortcutKeys.alt': 'Alt',
  'shortcutKeys.delete': 'Del',
  'shortcutKeys.escape': 'Esc',
}
const tagged = (k: string) => KEY_NAMES[k] ?? `t:${k}`

const key = (value: string, modifiers: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
})

describe('Canvas Command Projection', () => {
  it('owns the tool rail groups and single keys from the Menus board', () => {
    const projection = createCanvasCommandProjection({ state: state(), intents: intentAdapter(), translate: (k) => k })

    expect(projection.toolGroups.map((group) => ({
      id: group.id,
      heading: group.heading,
      tools: group.tools.map((tool) => [tool.tool, tool.shortcut]),
    }))).toEqual([
      { id: 'navigate', heading: undefined, tools: [['select', 'V'], ['hand', 'H']] },
      { id: 'plant', heading: undefined, tools: [['plant-stamp', 'P'], ['plant-spacing', 'W'], ['object-stamp', 'K']] },
      { id: 'zones', heading: 'canvas.tools.zones', tools: [['polygon', 'Z'], ['rectangle', 'R'], ['ellipse', 'E'], ['line', 'L']] },
      { id: 'annotate', heading: undefined, tools: [['text', 'T'], ['measurement-guide', 'M']] },
    ])
    expect(projectedCanvasTools(projection).every((tool) => tool.ariaShortcut === tool.shortcut)).toBe(true)
  })

  it('matches single keys, Shift toggles and Ctrl edits without confusing them', () => {
    expect(canvasCommandIdForShortcut(key('z'))).toBe('canvas.tool.polygon')
    expect(canvasCommandIdForShortcut(key('z', { ctrlKey: true }))).toBe('edit.undo')
    expect(canvasCommandIdForShortcut(key('Z', { metaKey: true, shiftKey: true }))).toBe('edit.redo')
    expect(canvasCommandIdForShortcut(key('y', { ctrlKey: true }))).toBe('edit.redo')
    expect(canvasCommandIdForShortcut(key('z', { ctrlKey: true, metaKey: true }))).toBeNull()
    expect(canvasCommandIdForShortcut(key('z', { ctrlKey: true, altKey: true }))).toBeNull()
    expect(canvasCommandIdForShortcut(key('G', { shiftKey: true }))).toBe('canvas.toggleGrid')
    expect(canvasCommandIdForShortcut(key('g', { ctrlKey: true }))).toBe('canvas.groupSelected')
    expect(canvasCommandIdForShortcut(key('G', { ctrlKey: true, shiftKey: true }))).toBe('canvas.ungroupSelected')
    expect(canvasCommandIdForShortcut(key('F', { shiftKey: true }))).toBe('view.fitToDesign')
    expect(canvasCommandIdForShortcut(key('0', { ctrlKey: true }))).toBe('view.fitToDesign')
    expect(canvasCommandIdForShortcut(key('=', { ctrlKey: true }))).toBe('view.zoomIn')
    expect(canvasCommandIdForShortcut(key('+', { ctrlKey: true, shiftKey: true }))).toBe('view.zoomIn')
    expect(canvasCommandIdForShortcut(key('-', { ctrlKey: true }))).toBe('view.zoomOut')
    expect(canvasCommandIdForShortcut(key('k', { ctrlKey: true }))).toBe('view.searchPlace')
    expect(canvasCommandIdForShortcut(key('f', { ctrlKey: true }))).toBeNull()
    expect(canvasCommandIdForShortcut(key('A', { ctrlKey: true, shiftKey: true }))).toBe('canvas.selectSameSpecies')
    expect(canvasCommandIdForShortcut(key('Backspace'))).toBe('canvas.deleteSelected')
    expect(canvasCommandIdForShortcut(key('E', { shiftKey: true }))).toBeNull()
  })

  it('shows shortcuts with spaces and localized key names, and exposes both modifiers to assistive tech', () => {
    expect(formatShortcut('Ctrl+Shift+Z')).toBe('Ctrl Shift Z')
    expect(formatShortcut('Ctrl+Plus')).toBe('Ctrl +')
    expect(formatShortcut('Ctrl+Shift+A', (k) => ({ 'shortcutKeys.ctrl': 'Ctrl', 'shortcutKeys.shift': 'Maj' })[k] ?? k)).toBe('Ctrl Maj A')
    expect(ariaKeyShortcuts('Ctrl+Shift+Z')).toBe('Control+Shift+Z Meta+Shift+Z')
    expect(ariaKeyShortcuts('Ctrl+Plus')).toBe('Control+= Meta+=')
    expect(ariaKeyShortcuts('Shift+G')).toBe('Shift+G')
  })

  it('dispatches the chosen tool and marks the active one', () => {
    const intents = intentAdapter()
    const projection = createCanvasCommandProjection({ state: state({ activeTool: 'ellipse' }), intents, translate: (k) => `t:${k}` })
    const ellipse = projectedCanvasTools(projection).find((tool) => tool.tool === 'ellipse')!

    expect(ellipse).toMatchObject({ commandId: 'canvas.tool.ellipse', label: 't:canvas.tools.ellipse', active: true, disabled: false })
    ellipse.action()
    expect(intents.selectTool).toHaveBeenCalledWith('ellipse')
  })

  it('keeps Select and Pan while overview disables every editing tool and mutating edit', () => {
    const intents = intentAdapter()
    const projection = createCanvasCommandProjection({
      state: state({ spatialEditingAvailable: false, hasSelection: true }),
      intents,
      translate: (k) => k,
    })
    const tools = projectedCanvasTools(projection)

    expect(tools.filter((tool) => !tool.disabled).map((tool) => tool.tool)).toEqual(['select', 'hand'])
    tools.find((tool) => tool.tool === 'polygon')!.action()
    expect(intents.selectTool).not.toHaveBeenCalled()
    const edits = Object.fromEntries(projection.editActions.map((edit) => [edit.id, edit.disabled]))
    expect(edits).toMatchObject({ copy: false, 'select-all': false, cut: true, paste: true, delete: true, group: true, lock: true })
    expect(projection.viewActions.every((view) => !view.disabled)).toBe(true)
  })

  it('enables selection edits only with a selection, and same-species only for one species', () => {
    const empty = createCanvasCommandProjection({ state: state(), intents: intentAdapter(), translate: (k) => k })
    const disabled = (projection: typeof empty) => projection.editActions.filter((edit) => edit.disabled).map((edit) => edit.id)
    expect(disabled(empty)).toEqual([
      'cut', 'copy', 'duplicate', 'delete', 'select-same-species', 'group', 'ungroup',
      'bring-to-front', 'send-to-back', 'lock', 'unlock', 'save-as-stamp',
    ])

    const intents = intentAdapter()
    const selected = createCanvasCommandProjection({
      state: state({ hasSelection: true, sameSpeciesSelectionAvailable: true }),
      intents,
      translate: (k) => k,
    })
    expect(disabled(selected)).toEqual([])
    selected.editActions.find((edit) => edit.id === 'select-same-species')!.action()
    expect(intents.edit).toHaveBeenCalledWith('select-same-species')

    const noCanvas = createCanvasCommandProjection({ state: state({ canvasAvailable: false }), intents: intentAdapter(), translate: (k) => k })
    expect(noCanvas.editActions.every((edit) => edit.disabled)).toBe(true)
    expect(noCanvas.viewActions.every((view) => view.disabled)).toBe(true)
  })

  it('projects history, view commands and pressed view toggles', () => {
    const intents = intentAdapter()
    const projection = createCanvasCommandProjection({
      state: state({ canUndo: true, gridVisible: true, snapToGridEnabled: false }),
      intents,
      translate: tagged,
    })

    expect(projection.historyActions.map(({ action: _action, ...command }) => command)).toEqual([
      { id: 'undo', commandId: 'edit.undo', label: 't:menu.edit.undo', shortcut: 'Ctrl Z', ariaShortcut: 'Control+Z Meta+Z', disabled: false },
      {
        id: 'redo',
        commandId: 'edit.redo',
        label: 't:menu.edit.redo',
        shortcut: 'Ctrl Shift Z',
        ariaShortcut: 'Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y',
        disabled: true,
      },
    ])
    projection.historyActions.forEach((command) => command.action())
    expect(intents.undo).toHaveBeenCalledOnce()
    expect(intents.redo).not.toHaveBeenCalled()

    expect(projection.viewActions.map((view) => [view.id, view.shortcut])).toEqual([
      ['zoom-in', 'Ctrl +'],
      ['zoom-out', 'Ctrl −'],
      ['fit-to-design', 'Shift F'],
      ['search-place', 'Ctrl K'],
    ])
    projection.viewActions[2]!.action()
    expect(intents.view).toHaveBeenCalledWith('fit-to-design')

    expect(projection.settingsToggles.map((toggle) => [toggle.id, toggle.shortcut, toggle.pressed])).toEqual([
      ['grid', 'Shift G', true],
      ['snap', 'Shift S', false],
      ['rulers', 'Shift R', false],
    ])
    projection.settingsToggles.forEach((toggle) => toggle.action())
    expect(intents.toggleGrid).toHaveBeenCalledOnce()
    expect(intents.toggleSnapToGrid).toHaveBeenCalledOnce()
    expect(intents.toggleRulers).toHaveBeenCalledOnce()
  })
})
