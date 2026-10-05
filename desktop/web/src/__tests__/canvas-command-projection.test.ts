import { describe, expect, it, vi } from 'vitest'
import {
  createCanvasCommandProjection,
  type CanvasCommandIntentAdapter,
  type CanvasCommandProjection,
  type CanvasCommandProjectionState,
} from '../app/canvas-commands'
import { ariaKeyShortcuts, formatShortcut } from '../app/shell-commands/shortcut-text'

/** Every tool, in rail order. */
const projectedCanvasTools = (projection: CanvasCommandProjection) =>
  projection.toolGroups.flatMap((group) => group.tools)

function intentAdapter(): CanvasCommandIntentAdapter {
  return {
    selectTool: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    toggleGrid: vi.fn(),
    toggleSnapToGrid: vi.fn(),
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
    rotateAvailable: false,
    lockedObjectsPresent: false,
    canUndo: false,
    canRedo: false,
    settingsAvailable: true,
    gridVisible: false,
    snapToGridEnabled: true,
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
    ellipse.action('rail')
    expect(intents.selectTool).toHaveBeenCalledWith('ellipse', 'rail')
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
    tools.find((tool) => tool.tool === 'polygon')!.action('menu')
    expect(intents.selectTool).not.toHaveBeenCalled()
    const edits = Object.fromEntries(projection.editActions.map((edit) => [edit.id, edit.disabled]))
    expect(edits).toMatchObject({ copy: false, 'select-all': false, cut: true, paste: true, delete: true, group: true, lock: true })
    expect(projection.viewActions.every((view) => !view.disabled)).toBe(true)
  })

  it('enables selection edits only with a selection, and same-species only for one species', () => {
    const empty = createCanvasCommandProjection({ state: state(), intents: intentAdapter(), translate: (k) => k })
    const disabled = (projection: typeof empty) => projection.editActions.filter((edit) => edit.disabled).map((edit) => edit.id)
    expect(disabled(empty)).toEqual([
      'cut', 'copy', 'duplicate', 'delete', 'select-same-species', 'deselect', 'group', 'ungroup',
      'bring-to-front', 'send-to-back', 'rotate', 'lock', 'unlock', 'unlock-all', 'save-as-stamp',
    ])
    const onePlant = createCanvasCommandProjection({ state: state({ hasSelection: true }), intents: intentAdapter(), translate: (k) => k })
    // A single plant, a measurement or a locked object cannot turn.
    expect(disabled(onePlant)).toEqual(['select-same-species', 'rotate', 'unlock-all'])

    const intents = intentAdapter()
    const selected = createCanvasCommandProjection({
      state: state({ hasSelection: true, sameSpeciesSelectionAvailable: true, rotateAvailable: true, lockedObjectsPresent: true }),
      intents,
      translate: (k) => k,
    })
    expect(disabled(selected)).toEqual([])
    selected.editActions.find((edit) => edit.id === 'select-same-species')!.action()
    expect(intents.edit).toHaveBeenCalledWith('select-same-species')
    const rotate = selected.editActions.find((edit) => edit.id === 'rotate')!
    expect(rotate).toMatchObject({ commandId: 'canvas.rotateSelected', label: 'menu.edit.rotate', ariaShortcut: 'Control+Alt+R Meta+Alt+R' })
    rotate.action()
    expect(intents.edit).toHaveBeenCalledWith('rotate')
    // Deselect shows Esc, which the map's own Esc chain handles: no keymap row routes to it (keymap.test.ts).
    const deselect = selected.editActions.find((edit) => edit.id === 'deselect')!
    expect(deselect).toMatchObject({ commandId: 'canvas.clearSelection', label: 'menu.edit.deselect', shortcut: 'shortcutKeys.escape', ariaShortcut: 'Escape' })
    // Unlock all needs no selection, only a locked object somewhere in the Design.
    const unlockAll = createCanvasCommandProjection({ state: state({ lockedObjectsPresent: true }), intents: intentAdapter(), translate: (k) => k })
      .editActions.find((edit) => edit.id === 'unlock-all')!
    expect(unlockAll).toMatchObject({ commandId: 'canvas.unlockAll', label: 'menu.edit.unlockAll', disabled: false })

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
      ['reset-north', 'N'],
      ['turn-view-left', 'Shift ←'],
      ['turn-view-right', 'Shift →'],
      ['search-place', 'Ctrl K'],
      ['cycle-labels', 'Shift L'],
    ])
    projection.viewActions[2]!.action()
    expect(intents.view).toHaveBeenCalledWith('fit-to-design')

    expect(projection.settingsToggles.map((toggle) => [toggle.id, toggle.shortcut, toggle.pressed])).toEqual([
      ['grid', 'Shift G', true],
      ['snap', 'Shift S', false],
    ])
    projection.settingsToggles.forEach((toggle) => toggle.action())
    expect(intents.toggleGrid).toHaveBeenCalledOnce()
    expect(intents.toggleSnapToGrid).toHaveBeenCalledOnce()
  })
})
