import { describe, expect, it, vi } from 'vitest'
import {
  canvasHistoryCommandIdForShortcut,
  canvasToolCommandIdForShortcut,
  createCanvasCommandProjection,
  type CanvasCommandIntentAdapter,
} from '../app/canvas-commands'

function intentAdapter(): CanvasCommandIntentAdapter {
  return {
    selectTool: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    toggleGrid: vi.fn(),
    toggleSnapToGrid: vi.fn(),
    toggleRulers: vi.fn(),
  }
}

describe('Canvas Command Projection', () => {
  it('matches projected tool and history shortcuts from the neutral catalog', () => {
    expect(canvasToolCommandIdForShortcut({
      key: 'e',
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    })).toBe('canvas.tool.ellipse')
    expect(canvasToolCommandIdForShortcut({
      key: 'E',
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
      altKey: false,
    })).toBeNull()
    expect(canvasHistoryCommandIdForShortcut({
      key: 'z',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    })).toBe('edit.undo')
    expect(canvasHistoryCommandIdForShortcut({
      key: 'Z',
      ctrlKey: false,
      metaKey: true,
      shiftKey: true,
      altKey: false,
    })).toBe('edit.redo')
    expect(canvasHistoryCommandIdForShortcut({
      key: 'z',
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    })).toBeNull()
    expect(canvasHistoryCommandIdForShortcut({
      key: 'z',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: true,
    })).toBeNull()
    expect(canvasHistoryCommandIdForShortcut({
      key: 'z',
      ctrlKey: true,
      metaKey: true,
      shiftKey: false,
      altKey: false,
    })).toBeNull()
  })

  it('owns the exact navigation, creation, and reuse tool groups', () => {
    const projection = createCanvasCommandProjection({
      state: {
        activeTool: 'select',
        toolSelectionAvailable: true,
        canUndo: false,
        canRedo: false,
        settingsAvailable: true,
        gridVisible: true,
        snapToGridEnabled: false,
        rulersVisible: true,
      },
      intents: intentAdapter(),
      translate: (key) => `resolved:${key}`,
    })

    expect(projection.primaryTools.map((command) => command.tool)).toEqual([
      'select',
      'hand',
    ])
    expect(projection.creationTools.map((command) => command.tool)).toEqual([
      'line',
      'rectangle',
      'ellipse',
      'polygon',
      'text',
      'measurement-guide',
    ])
    expect(projection.reuseTools.map((command) => command.tool)).toEqual([
      'object-stamp',
      'plant-spacing',
    ])
    expect([
      ...projection.primaryTools,
      ...projection.creationTools,
      ...projection.reuseTools,
    ].map(({ action: _action, active: _active, disabled: _disabled, ...command }) => command)).toEqual([
      {
        tool: 'select',
        commandId: 'canvas.tool.select',
        label: 'resolved:canvas.tools.select',
        description: 'resolved:canvas.tools.selectDesc',
        shortcut: 'V',
        ariaShortcut: 'V',
      },
      {
        tool: 'hand',
        commandId: 'canvas.tool.hand',
        label: 'resolved:canvas.tools.hand',
        description: 'resolved:canvas.tools.handDesc',
        shortcut: 'H',
        ariaShortcut: 'H',
      },
      {
        tool: 'line',
        commandId: 'canvas.tool.line',
        label: 'resolved:canvas.tools.line',
        description: 'resolved:canvas.tools.lineDesc',
        shortcut: 'L',
        ariaShortcut: 'L',
      },
      {
        tool: 'rectangle',
        commandId: 'canvas.tool.rectangle',
        label: 'resolved:canvas.tools.rectangle',
        description: 'resolved:canvas.tools.rectangleDesc',
        shortcut: 'R',
        ariaShortcut: 'R',
      },
      {
        tool: 'ellipse',
        commandId: 'canvas.tool.ellipse',
        label: 'resolved:canvas.tools.ellipse',
        description: 'resolved:canvas.tools.ellipseDesc',
        shortcut: 'E',
        ariaShortcut: 'E',
      },
      {
        tool: 'polygon',
        commandId: 'canvas.tool.polygon',
        label: 'resolved:canvas.tools.polygon',
        description: 'resolved:canvas.tools.polygonDesc',
        shortcut: 'P',
        ariaShortcut: 'P',
      },
      {
        tool: 'text',
        commandId: 'canvas.tool.text',
        label: 'resolved:canvas.tools.text',
        description: 'resolved:canvas.tools.textDesc',
        shortcut: 'T',
        ariaShortcut: 'T',
      },
      {
        tool: 'measurement-guide',
        commandId: 'canvas.tool.measurementGuide',
        label: 'resolved:canvas.tools.measurementGuide',
        description: 'resolved:canvas.tools.measurementGuideDesc',
        shortcut: undefined,
        ariaShortcut: undefined,
      },
      {
        tool: 'object-stamp',
        commandId: 'canvas.tool.objectStamp',
        label: 'resolved:canvas.tools.objectStamp',
        description: 'resolved:canvas.tools.objectStampDesc',
        shortcut: undefined,
        ariaShortcut: undefined,
      },
      {
        tool: 'plant-spacing',
        commandId: 'canvas.tool.plantSpacing',
        label: 'resolved:canvas.tools.plantSpacing',
        description: 'resolved:canvas.tools.plantSpacingDesc',
        shortcut: 'S',
        ariaShortcut: 'S',
      },
    ])
  })

  it('resolves tool identity, copy, shortcuts, and availability for the caller', () => {
    const intents = intentAdapter()
    const projection = createCanvasCommandProjection({
      state: {
        activeTool: 'ellipse',
        toolSelectionAvailable: true,
        canUndo: false,
        canRedo: false,
        settingsAvailable: false,
        gridVisible: true,
        snapToGridEnabled: false,
        rulersVisible: true,
      },
      intents,
      translate: (key) => `resolved:${key}`,
    })

    expect(projection.creationTools[2]).toMatchObject({
      tool: 'ellipse',
      commandId: 'canvas.tool.ellipse',
      label: 'resolved:canvas.tools.ellipse',
      description: 'resolved:canvas.tools.ellipseDesc',
      shortcut: 'E',
      active: true,
      disabled: false,
    })

    projection.creationTools[2]?.action()

    expect(intents.selectTool).toHaveBeenCalledWith('ellipse')
  })

  it('projects history state and dispatches history intent', () => {
    const intents = intentAdapter()
    const projection = createCanvasCommandProjection({
      state: {
        activeTool: 'select',
        toolSelectionAvailable: true,
        canUndo: true,
        canRedo: false,
        settingsAvailable: true,
        gridVisible: true,
        snapToGridEnabled: false,
        rulersVisible: true,
      },
      intents,
      translate: (key) => `resolved:${key}`,
    })

    expect(projection.historyActions.map(({ action: _action, ...command }) => command)).toEqual([
      {
        id: 'undo',
        commandId: 'edit.undo',
        label: 'resolved:menu.edit.undo',
        shortcut: 'Ctrl+Z',
        ariaShortcut: 'Control+Z Meta+Z',
        disabled: false,
      },
      {
        id: 'redo',
        commandId: 'edit.redo',
        label: 'resolved:menu.edit.redo',
        shortcut: 'Ctrl+Shift+Z',
        ariaShortcut: 'Control+Shift+Z Meta+Shift+Z',
        disabled: true,
      },
    ])

    projection.historyActions[0]?.action()
    projection.historyActions[1]?.action()

    expect(intents.undo).toHaveBeenCalledTimes(1)
    expect(intents.redo).not.toHaveBeenCalled()
  })

  it('projects settings state, descriptions, and toggle intents', () => {
    const intents = intentAdapter()
    const projection = createCanvasCommandProjection({
      state: {
        activeTool: 'select',
        toolSelectionAvailable: true,
        canUndo: false,
        canRedo: false,
        settingsAvailable: true,
        gridVisible: true,
        snapToGridEnabled: false,
        rulersVisible: true,
      },
      intents,
      translate: (key) => `resolved:${key}`,
    })

    expect(projection.settingsToggles.map(({ action: _action, ...command }) => command)).toEqual([
      {
        id: 'grid',
        commandId: 'canvas.toggleGrid',
        label: 'resolved:canvas.grid.grid',
        description: 'resolved:canvas.grid.gridDesc',
        disabled: false,
        pressed: true,
      },
      {
        id: 'snap',
        commandId: 'canvas.toggleSnapToGrid',
        label: 'resolved:canvas.grid.snapToGrid',
        description: 'resolved:canvas.grid.snapToGridDesc',
        disabled: false,
        pressed: false,
      },
      {
        id: 'rulers',
        commandId: 'canvas.toggleRulers',
        label: 'resolved:canvas.grid.rulers',
        description: 'resolved:canvas.grid.rulersDesc',
        disabled: false,
        pressed: true,
      },
    ])

    projection.settingsToggles.forEach((command) => command.action())

    expect(intents.toggleGrid).toHaveBeenCalledTimes(1)
    expect(intents.toggleSnapToGrid).toHaveBeenCalledTimes(1)
    expect(intents.toggleRulers).toHaveBeenCalledTimes(1)
  })
})
