import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  gridVisible,
  rulersVisible,
  snapToGridEnabled,
} from '../app/canvas-settings/signals'
import { locale } from '../app/settings/state'
import { activePanel, sidePanel } from '../app/shell/state'
import { setCurrentCanvasSession } from '../canvas/session'
import { activeTool, selectedObjectIds } from '../canvas/session-state'
import { CanvasToolbar } from '../components/canvas/CanvasToolbar'
import { WebCanvasToolbar } from '../web/WebCanvasToolbar'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

interface ToolButtonSnapshot {
  readonly tool: string | undefined
  readonly label: string | null
  readonly ariaShortcut: string | null
  readonly active: string | null
  readonly disabled: boolean
}

interface ActionButtonSnapshot {
  readonly commandId: string | undefined
  readonly label: string | null
  readonly ariaShortcut: string | null
  readonly pressed: string | null
  readonly disabled: boolean
}

describe('Canvas toolbar command parity', () => {
  let desktopContainer: HTMLDivElement
  let webContainer: HTMLDivElement

  beforeEach(() => {
    document.body.innerHTML = ''
    desktopContainer = document.createElement('div')
    webContainer = document.createElement('div')
    document.body.append(desktopContainer, webContainer)
    locale.value = 'en'
    activePanel.value = 'canvas'
    sidePanel.value = null
    activeTool.value = 'select'
    selectedObjectIds.value = new Set()
    gridVisible.value = true
    snapToGridEnabled.value = false
    rulersVisible.value = true
  })

  afterEach(() => {
    render(null, desktopContainer)
    render(null, webContainer)
    setCurrentCanvasSession(null)
    desktopContainer.remove()
    webContainer.remove()
  })

  it('renders the same Canvas tool, history, and settings command projection', async () => {
    const canUndo = signal(true)
    const canRedo = signal(false)
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        history: { canUndo, canRedo },
      }),
    }))

    await act(async () => {
      render(<CanvasToolbar />, desktopContainer)
      render(<WebCanvasToolbar />, webContainer)
      await Promise.resolve()
    })

    const desktopTools = toolButtons(desktopContainer)
    const webTools = toolButtons(webContainer)
    const desktopActions = actionButtons(desktopContainer)
    const webActions = actionButtons(webContainer)

    expect(webTools).toEqual(desktopTools)
    expect(webActions).toEqual(desktopActions)
    expect(desktopTools.map((command) => command.tool)).toEqual([
      'select',
      'hand',
      'line',
      'rectangle',
      'ellipse',
      'polygon',
      'text',
      'measurement-guide',
      'object-stamp',
      'plant-spacing',
    ])
    expect(desktopActions.map((command) => command.commandId)).toEqual([
      'edit.undo',
      'edit.redo',
      'canvas.toggleGrid',
      'canvas.toggleSnapToGrid',
      'canvas.toggleRulers',
    ])
    expect(desktopActions.slice(0, 2).map((command) => command.ariaShortcut)).toEqual([
      'Control+Z Meta+Z',
      'Control+Shift+Z Meta+Shift+Z',
    ])
  })

  it('keeps both rendered surfaces in sync through dispatch and disabled transitions', async () => {
    const canUndo = signal(false)
    const setTool = vi.fn()
    const undo = vi.fn()
    const toggleGrid = vi.fn(() => {
      gridVisible.value = !gridVisible.value
    })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        tools: { setTool },
        history: { canUndo, undo },
        chrome: { toggleGrid },
      }),
    }))

    await act(async () => {
      render(<CanvasToolbar />, desktopContainer)
      render(<WebCanvasToolbar />, webContainer)
      await Promise.resolve()
    })

    const desktopUndo = commandButton(desktopContainer, 'edit.undo')
    const webUndo = commandButton(webContainer, 'edit.undo')
    expect(desktopUndo.disabled).toBe(true)
    expect(webUndo.disabled).toBe(true)

    await act(async () => {
      canUndo.value = true
      await Promise.resolve()
    })

    expect(desktopUndo.disabled).toBe(false)
    expect(webUndo.disabled).toBe(false)

    await act(async () => {
      toolButton(webContainer, 'ellipse').click()
      desktopUndo.click()
      webUndo.click()
      commandButton(webContainer, 'canvas.toggleGrid').click()
      await Promise.resolve()
    })

    expect(setTool).toHaveBeenCalledWith('ellipse')
    expect(toolButton(desktopContainer, 'ellipse').getAttribute('aria-checked')).toBe('true')
    expect(toolButton(webContainer, 'ellipse').getAttribute('aria-checked')).toBe('true')
    expect(undo).toHaveBeenCalledTimes(2)
    expect(toggleGrid).toHaveBeenCalledTimes(1)
    expect(commandButton(desktopContainer, 'canvas.toggleGrid').getAttribute('aria-pressed')).toBe('false')
    expect(commandButton(webContainer, 'canvas.toggleGrid').getAttribute('aria-pressed')).toBe('false')

    await act(async () => {
      setCurrentCanvasSession(null)
      await Promise.resolve()
    })

    expect(desktopUndo.disabled).toBe(true)
    expect(webUndo.disabled).toBe(true)
    expect(commandButton(desktopContainer, 'canvas.toggleGrid').disabled).toBe(true)
    expect(commandButton(webContainer, 'canvas.toggleGrid').disabled).toBe(true)
  })

  it('keeps both rendered tool groups reachable with the same roving keyboard behavior', async () => {
    const setTool = vi.fn()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({ tools: { setTool } }),
    }))

    await act(async () => {
      render(<CanvasToolbar />, desktopContainer)
      render(<WebCanvasToolbar />, webContainer)
      await Promise.resolve()
    })

    for (const container of [desktopContainer, webContainer]) {
      await act(async () => {
        activeTool.value = 'select'
        await Promise.resolve()
      })

      const toolbar = container.querySelector<HTMLDivElement>('[role="toolbar"]')
      if (!toolbar) throw new Error('Missing Canvas toolbar')

      await act(async () => {
        toolbar.focus()
        await Promise.resolve()
      })
      expect(document.activeElement).toBe(toolButton(container, 'select'))

      await act(async () => {
        toolButton(container, 'select').dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          cancelable: true,
        }))
        await Promise.resolve()
      })
      expect(activeTool.value).toBe('hand')
      expect(document.activeElement).toBe(toolButton(container, 'hand'))

      await act(async () => {
        toolButton(container, 'hand').dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowUp',
          bubbles: true,
          cancelable: true,
        }))
        await Promise.resolve()
      })
      expect(activeTool.value).toBe('select')
      expect(document.activeElement).toBe(toolButton(container, 'select'))
    }

    expect(setTool.mock.calls).toEqual([
      ['hand'],
      ['select'],
      ['hand'],
      ['select'],
    ])
  })
})

function toolButtons(container: HTMLElement): ToolButtonSnapshot[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-tool]'))
    .map((button) => ({
      tool: button.dataset.tool,
      label: button.getAttribute('aria-label'),
      ariaShortcut: button.getAttribute('aria-keyshortcuts'),
      active: button.getAttribute('aria-checked'),
      disabled: button.disabled,
    }))
}

function actionButtons(container: HTMLElement): ActionButtonSnapshot[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-command]'))
    .map((button) => ({
      commandId: button.dataset.command,
      label: button.getAttribute('aria-label'),
      ariaShortcut: button.getAttribute('aria-keyshortcuts'),
      pressed: button.getAttribute('aria-pressed'),
      disabled: button.disabled,
    }))
}

function commandButton(container: HTMLElement, commandId: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[data-command="${commandId}"]`)
  if (!button) throw new Error(`Missing ${commandId} button`)
  return button
}

function toolButton(container: HTMLElement, tool: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[data-tool="${tool}"]`)
  if (!button) throw new Error(`Missing ${tool} button`)
  return button
}
