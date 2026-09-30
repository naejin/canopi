import { signal } from '@preact/signals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GestureOutcome, ToolHost } from './interaction-ports'
import type { ToolId } from './interaction-types'
import { createCanvasKeyboardPort, type LegacyKeyBridge, type LegacyKeySession } from './keyboard-port'
import type { ToolCommand, ToolReply } from './tools/tool'
import type { ViewFrameSource } from './view/types'

let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  host.tabIndex = 0
  document.body.appendChild(host)
})

afterEach(() => {
  host.remove()
  document.body.innerHTML = ''
})

interface Fixture {
  readonly tool: ReturnType<typeof signal<ToolId>>
  readonly registered: Set<ToolId>
  readonly toolHost: {
    nudge: ReturnType<typeof vi.fn>
    command: ReturnType<typeof vi.fn>
    menuAt: ReturnType<typeof vi.fn>
    endNudgeSeries: ReturnType<typeof vi.fn>
    interrupted: ReturnType<typeof vi.fn>
    retryPendingCancellation: ReturnType<typeof vi.fn>
  }
  readonly legacy: LegacyKeySession & { [K in keyof LegacyKeySession]: LegacyKeySession[K] }
  readonly bridge: { [K in keyof LegacyKeyBridge]: ReturnType<typeof vi.fn> }
  readonly navigation: { panByPx: ReturnType<typeof vi.fn>; zoomIn: ReturnType<typeof vi.fn>; zoomOut: ReturnType<typeof vi.fn>; resetNorth: ReturnType<typeof vi.fn>; rotateBy: ReturnType<typeof vi.fn> }
  selected: boolean
  nudging: boolean
  live: boolean
  space: boolean
  port: ReturnType<typeof createCanvasKeyboardPort>
}

function fixture(options: { readonly tool?: ToolId; readonly registered?: readonly ToolId[]; readonly reply?: (c: ToolCommand) => ToolReply } = {}): Fixture {
  const tool = signal<ToolId>(options.tool ?? 'select')
  const registered = new Set<ToolId>(options.registered ?? ['select', 'polygon', 'object-stamp'])
  const state = { selected: false, nudging: false, live: false, space: false }
  const toolHost = {
    nudge: vi.fn((): 'handled' | 'refused' | 'pass' => 'pass'),
    command: vi.fn(options.reply ?? ((): ToolReply => 'pass')),
    menuAt: vi.fn((): GestureOutcome => ({})),
    endNudgeSeries: vi.fn(() => {
      state.nudging = false
    }),
    interrupted: vi.fn(),
    retryPendingCancellation: vi.fn(() => false),
  }
  const hostFake = {
    ...toolHost,
    activeTool: tool,
    isRegistered: (id: ToolId) => registered.has(id),
    hasNudgeSeries: () => state.nudging,
    activeToolIsSelect: () => tool.peek() === 'select',
    activeToolHasTransient: () => false,
  } as unknown as ToolHost
  const bridge = {
    retryPendingCancellation: vi.fn(() => false),
    cancelInterrupted: vi.fn(),
    hasActiveSceneEdit: vi.fn(() => false),
    openMenuFromKeyboard: vi.fn(),
    toolKeyDown: vi.fn(() => false),
    suppressesSharedKeyboard: vi.fn(() => false),
    editSelectedNote: vi.fn(() => false),
    publishGuidance: vi.fn(),
  }
  const legacy = {
    bridge,
    pointerSessionLive: () => state.live,
    overview: vi.fn(() => false),
    spaceHeld: () => state.space,
    keyState: vi.fn((next: { readonly space: boolean }) => {
      state.space = next.space
    }),
    escapeGesture: vi.fn(),
    requestTool: vi.fn((id: ToolId) => {
      tool.value = id
    }),
    clearSelection: vi.fn(() => {
      state.selected = false
    }),
    readSingleKeyShortcuts: vi.fn(() => true),
  }
  const navigation = { panByPx: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), resetNorth: vi.fn(), rotateBy: vi.fn() }
  const result = {
    tool,
    registered,
    toolHost,
    legacy,
    bridge,
    navigation,
    get selected() { return state.selected },
    set selected(value: boolean) { state.selected = value },
    get nudging() { return state.nudging },
    set nudging(value: boolean) { state.nudging = value },
    get live() { return state.live },
    set live(value: boolean) { state.live = value },
    get space() { return state.space },
    set space(value: boolean) { state.space = value },
    port: undefined as unknown as ReturnType<typeof createCanvasKeyboardPort>,
  }
  result.port = createCanvasKeyboardPort({
    host,
    toolHost: hostFake,
    hasSelection: () => state.selected,
    navigation,
    frames: {} as ViewFrameSource,
    legacy,
  })
  return result as unknown as Fixture
}

function key(port: Fixture['port'], init: KeyboardEventInit & { readonly target?: EventTarget }): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  Object.defineProperty(event, 'target', { value: init.target ?? host })
  port.keydown(event)
  return event
}

describe('createCanvasKeyboardPort', () => {
  it('an arrow asks the host to nudge, and a handled or refused nudge takes the key', () => {
    const f = fixture()
    f.selected = true
    f.toolHost.nudge.mockReturnValueOnce('handled').mockReturnValueOnce('refused')

    const handled = key(f.port, { key: 'ArrowRight' })
    const refused = key(f.port, { key: 'ArrowUp', shiftKey: true })

    expect(f.toolHost.nudge.mock.calls).toEqual([[{ x: 1, y: 0 }, false], [{ x: 0, y: -1 }, true]])
    expect(handled.defaultPrevented).toBe(true)
    expect(refused.defaultPrevented).toBe(true)
    expect(f.navigation.panByPx).not.toHaveBeenCalled()
  })

  it('on a pass the arrow pans 64 px, 256 px with Shift, with nothing selected, and is let through otherwise', () => {
    const f = fixture({ tool: 'polygon' })

    expect(key(f.port, { key: 'ArrowRight' }).defaultPrevented).toBe(true)
    expect(key(f.port, { key: 'ArrowDown', shiftKey: true }).defaultPrevented).toBe(true)
    expect(f.navigation.panByPx.mock.calls).toEqual([[{ x: -64, y: 0 }], [{ x: 0, y: -256 }]])

    f.selected = true
    expect(key(f.port, { key: 'ArrowLeft' }).defaultPrevented).toBe(false)
    expect(f.navigation.panByPx).toHaveBeenCalledTimes(2)
  })

  it('an arrow waits for a live pointer session and leaves fields, controls and Ctrl, Cmd or Alt alone', () => {
    const f = fixture()
    const field = document.createElement('input')
    host.appendChild(field)
    key(f.port, { key: 'ArrowRight', target: field })
    key(f.port, { key: 'ArrowRight', ctrlKey: true })
    key(f.port, { key: 'ArrowRight', metaKey: true })
    key(f.port, { key: 'ArrowRight', altKey: true })
    key(f.port, { key: 'ArrowRight', target: document.body })
    f.live = true
    key(f.port, { key: 'ArrowRight' })
    expect(f.toolHost.nudge).not.toHaveBeenCalled()
    expect(f.navigation.panByPx).not.toHaveBeenCalled()
  })

  it('another key commits the nudge series and Esc aborts it', () => {
    const f = fixture()
    f.selected = true
    f.nudging = true
    key(f.port, { key: 'Shift' })
    expect(f.toolHost.endNudgeSeries).not.toHaveBeenCalled()
    key(f.port, { key: 'z', ctrlKey: true })
    expect(f.toolHost.endNudgeSeries).toHaveBeenLastCalledWith(true)

    f.nudging = true
    const escape = key(f.port, { key: 'Escape' })
    expect(escape.defaultPrevented).toBe(true)
    expect(f.toolHost.endNudgeSeries).toHaveBeenLastCalledWith(false)
    // The series took this Esc: the chain did not run.
    expect(f.legacy.clearSelection).not.toHaveBeenCalled()
  })

  it('[ and ] turn a held stamp only on a handled reply, under the editable-target and single-key rules', () => {
    const f = fixture({ tool: 'object-stamp', reply: (c) => c.kind === 'rotate-held' ? 'handled' : 'pass' })
    const turned = key(f.port, { key: ']' })
    expect(turned.defaultPrevented).toBe(true)
    expect(turned.cancelBubble).toBe(true)
    expect(f.toolHost.command).toHaveBeenLastCalledWith({ kind: 'rotate-held', stepDeg: 15 })
    key(f.port, { key: '[' })
    expect(f.toolHost.command).toHaveBeenLastCalledWith({ kind: 'rotate-held', stepDeg: -15 })
    expect(f.toolHost.command).toHaveBeenCalledTimes(2)

    const field = document.createElement('textarea')
    host.appendChild(field)
    key(f.port, { key: ']', target: field })
    key(f.port, { key: ']', ctrlKey: true })
    f.legacy.readSingleKeyShortcuts = () => false
    key(f.port, { key: ']', target: document.body })
    expect(f.toolHost.command).toHaveBeenCalledTimes(2)
    // Single-key shortcuts off: still on the focused map.
    key(f.port, { key: ']' })
    expect(f.toolHost.command).toHaveBeenCalledTimes(3)

    const refused = fixture({ tool: 'object-stamp' })
    const passed = key(refused.port, { key: ']' })
    expect(passed.defaultPrevented).toBe(false)
    expect(passed.cancelBubble).toBe(false)
  })

  it('Esc goes to the registered tool first, then a live pointer session, then the tool, then the selection', () => {
    let toolTakesEscape = true
    const f = fixture({ tool: 'polygon', reply: (c) => c.kind === 'escape' && toolTakesEscape ? 'handled' : 'pass' })
    f.selected = true

    expect(key(f.port, { key: 'Escape' }).defaultPrevented).toBe(true)
    expect(f.toolHost.command).toHaveBeenLastCalledWith({ kind: 'escape' })
    expect(f.legacy.escapeGesture).not.toHaveBeenCalled()

    toolTakesEscape = false
    f.live = true
    key(f.port, { key: 'Escape' })
    expect(f.legacy.escapeGesture).toHaveBeenCalledTimes(1)
    expect(f.legacy.requestTool).not.toHaveBeenCalled()

    f.live = false
    key(f.port, { key: 'Escape' })
    expect(f.legacy.requestTool).toHaveBeenCalledExactlyOnceWith('select')
    key(f.port, { key: 'Escape' })
    expect(f.legacy.clearSelection).toHaveBeenCalledTimes(1)
    expect(key(f.port, { key: 'Escape' }).defaultPrevented).toBe(false)
  })

  it('a bridged tool keeps its own keys, Esc cancel and guidance on the legacy bridge', () => {
    const f = fixture({ tool: 'rectangle' })
    f.bridge.toolKeyDown.mockReturnValueOnce(true)
    const consumed = key(f.port, { key: 'Backspace' })
    expect(consumed.defaultPrevented).toBe(true)
    expect(f.bridge.toolKeyDown).toHaveBeenCalledTimes(1)
    expect(f.toolHost.command).not.toHaveBeenCalled()

    f.live = true
    key(f.port, { key: 'Escape' })
    expect(f.bridge.cancelInterrupted).toHaveBeenCalledTimes(1)
    expect(f.legacy.escapeGesture).not.toHaveBeenCalled()
    expect(f.bridge.publishGuidance).toHaveBeenCalledTimes(2)

    f.bridge.retryPendingCancellation.mockReturnValueOnce(true)
    key(f.port, { key: 'Escape' })
    expect(f.bridge.cancelInterrupted).toHaveBeenCalledTimes(1)
  })

  it('a pending failed cancellation swallows the key before anything else for a registered tool', () => {
    const f = fixture()
    f.selected = true
    f.toolHost.retryPendingCancellation.mockReturnValueOnce(true)
    const listener = vi.fn()
    host.addEventListener('keydown', listener)
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    host.addEventListener('keydown', (e) => f.port.keydown(e), { capture: true })
    host.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(listener).not.toHaveBeenCalled()
    expect(f.toolHost.nudge).not.toHaveBeenCalled()
  })

  it('Space holds for panning once, keeps it in fields, and keyup releases it', () => {
    const f = fixture()
    const first = key(f.port, { key: ' ', code: 'Space' })
    const repeat = key(f.port, { key: ' ', code: 'Space' })
    expect(first.defaultPrevented).toBe(true)
    expect(repeat.defaultPrevented).toBe(false)
    expect(f.legacy.keyState).toHaveBeenCalledTimes(1)
    expect(f.legacy.keyState).toHaveBeenLastCalledWith({ space: true, mods: { shift: false, ctrl: false, alt: false, meta: false } })

    f.port.keyup(new KeyboardEvent('keyup', { key: ' ', code: 'Space' }))
    expect(f.space).toBe(false)
    const field = document.createElement('input')
    host.appendChild(field)
    expect(key(f.port, { key: ' ', code: 'Space', target: field }).defaultPrevented).toBe(false)
    expect(f.legacy.keyState).toHaveBeenCalledTimes(2)
  })

  it('in overview Esc cancels the interrupted gesture and Space still holds', () => {
    const f = fixture()
    f.legacy.overview = vi.fn(() => true)
    key(f.port, { key: 'Escape' })
    expect(f.legacy.escapeGesture).toHaveBeenCalledTimes(1)
    expect(f.toolHost.interrupted).toHaveBeenCalledTimes(1)
    expect(f.legacy.requestTool).not.toHaveBeenCalled()
    key(f.port, { key: ' ', code: 'Space' })
    expect(f.space).toBe(true)
  })

  it('the Menu key and Shift F10 open the selection\'s menu through the host and record the echo time', () => {
    const f = fixture()
    const menu = key(f.port, { key: 'ContextMenu' })
    expect(menu.defaultPrevented).toBe(true)
    expect(f.toolHost.menuAt).toHaveBeenCalledExactlyOnceWith('selection', 'keyboard')
    expect(f.port.lastKeyboardMenuAt()).toBe(menu.timeStamp)
    key(f.port, { key: 'F10', shiftKey: true })
    expect(f.toolHost.menuAt).toHaveBeenCalledTimes(2)
    f.live = true
    key(f.port, { key: 'ContextMenu' })
    expect(f.toolHost.menuAt).toHaveBeenCalledTimes(2)
  })

  it('Enter or F2 edits the selected note under Select, after the tool\'s own Enter', () => {
    const f = fixture({ reply: (c) => c.kind === 'edit-text' ? 'handled' : 'pass' })
    const enter = key(f.port, { key: 'Enter' })
    expect(f.toolHost.command.mock.calls.map(([c]) => c.kind)).toEqual(['confirm', 'edit-text'])
    expect(enter.defaultPrevented).toBe(true)
    key(f.port, { key: 'F2' })
    expect(f.toolHost.command).toHaveBeenLastCalledWith({ kind: 'edit-text' })
  })

  it('names the escape layers in order and runs the one asked for', () => {
    const f = fixture({ tool: 'polygon' })
    f.selected = true
    f.nudging = true
    f.live = true
    expect(f.port.escapeLayers()).toEqual(['gesture', 'nudge-series', 'tool', 'selection'])
    expect(f.port.describeEscape()).toBe('gesture')
    f.port.escape('nudge-series')
    expect(f.toolHost.endNudgeSeries).toHaveBeenLastCalledWith(false)
    f.port.escape('tool')
    expect(f.legacy.requestTool).toHaveBeenLastCalledWith('select')
    f.port.escape('selection')
    expect(f.legacy.clearSelection).toHaveBeenCalledTimes(1)
    f.live = false
    expect(f.port.describeEscape()).toBeNull()
  })

  it('key commands reach the host and the navigation', () => {
    const f = fixture({ reply: () => 'handled' })
    expect(f.port.command({ kind: 'confirm' })).toBe(true)
    expect(f.port.command({ kind: 'rotate-held', stepDeg: -15 })).toBe(true)
    expect(f.toolHost.command.mock.calls.map(([c]) => c)).toEqual([{ kind: 'confirm' }, { kind: 'rotate-held', stepDeg: -15 }])
    f.port.command({ kind: 'zoom-step', direction: 1 })
    f.port.command({ kind: 'zoom-step', direction: -1 })
    f.port.command({ kind: 'rotate-view', direction: -1 })
    f.port.command({ kind: 'reset-north' })
    expect(f.navigation.zoomIn).toHaveBeenCalledTimes(1)
    expect(f.navigation.zoomOut).toHaveBeenCalledTimes(1)
    expect(f.navigation.rotateBy).toHaveBeenCalledWith(-1)
    expect(f.navigation.resetNorth).toHaveBeenCalledTimes(1)
    expect(f.port.command({ kind: 'arrow', dir: 'left', large: false })).toBe(true)
    expect(f.navigation.panByPx).toHaveBeenCalledWith({ x: 64, y: 0 })
    expect(f.port.command({ kind: 'context-menu' })).toBe(true)
    expect(f.toolHost.menuAt).toHaveBeenCalledWith('selection', 'keyboard')
  })

  it('tracks the physical Control key for pinch detection', () => {
    const f = fixture()
    key(f.port, { key: 'Control', ctrlKey: true })
    expect(f.port.physicalCtrl()).toBe(true)
    f.port.keyup(new KeyboardEvent('keyup', { key: 'Control' }))
    expect(f.port.physicalCtrl()).toBe(false)
    key(f.port, { key: 'Control', ctrlKey: true })
    f.port.releaseKeys()
    expect(f.port.physicalCtrl()).toBe(false)
  })
})
