import { signal, type Signal } from '@preact/signals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasEscapeLayer, CanvasKeyboardPort, CanvasKeyCommand, CanvasKeyState, CanvasKeyVerdict } from '../../canvas/runtime/runtime'
import { installKeyRouter, type KeyRouterDeps, type KeyRouterHandle } from './key-router'
import { CANVAS_KEYMAP_ROWS, pushKeyScope, type KeymapRow } from './keymap'

/** A canvas port whose answers each test sets. */
function fakePort(host: HTMLElement) {
  const state = {
    verdict: 'pass' as CanvasKeyVerdict,
    layers: [] as CanvasEscapeLayer[],
    command: (_c: CanvasKeyCommand): boolean => true,
  }
  const port = {
    host,
    keyState: vi.fn((_k: CanvasKeyState): CanvasKeyVerdict => state.verdict),
    command: vi.fn((c: CanvasKeyCommand) => state.command(c)),
    escapeLayers: vi.fn(() => state.layers),
    escape: vi.fn((_layer: CanvasEscapeLayer) => {}),
    describeEscape: () => state.layers[0] ?? null,
  } satisfies CanvasKeyboardPort
  return { port, state }
}

const F2_RENAME_ROW: KeymapRow = { command: 'file.rename', chords: [{ key: 'F2', mod: false, ctrl: false, shift: false, alt: false }], scope: 'command', singleKey: 'n/a' }

let host: HTMLDivElement
let router: KeyRouterHandle | null
let modal: boolean
let singleKeys: Signal<boolean>
let run: ReturnType<typeof vi.fn<(command: string) => boolean>>
let cycleRegion: ReturnType<typeof vi.fn<(step: 1 | -1) => boolean>>
let fake: ReturnType<typeof fakePort>

function install(overrides: Partial<KeyRouterDeps> = {}): KeyRouterHandle {
  router = installKeyRouter({
    target: window,
    keymap: [F2_RENAME_ROW, ...CANVAS_KEYMAP_ROWS],
    commands: { run },
    canvas: () => fake.port,
    singleKeys,
    focus: { cycleRegion },
    isModalOpen: () => modal,
    platform: { os: 'linux', engine: 'chromium', gestureEvents: false },
    document,
    ...overrides,
  })
  return router
}

function press(init: KeyboardEventInit, target: EventTarget = document.activeElement ?? window): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

beforeEach(() => {
  host = document.createElement('div')
  host.tabIndex = 0
  document.body.append(host)
  router = null
  modal = false
  singleKeys = signal(true)
  run = vi.fn(() => true)
  cycleRegion = vi.fn(() => true)
  fake = fakePort(host)
})

afterEach(() => {
  router?.dispose()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('key router', () => {
  it('installs window capture and bubble keydown listeners and a capture keyup listener, and removes them', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const documentAdd = vi.spyOn(document, 'addEventListener')
    const documentRemove = vi.spyOn(document, 'removeEventListener')
    const capture = (options: unknown) => options === true
    const handle = install()

    const added = add.mock.calls.map(([type, listener, options]) => [type, listener, capture(options)])
    expect(added.map(([type, , isCapture]) => [type, isCapture])).toEqual([
      ['keydown', true],
      ['keydown', false],
      ['keyup', true],
      // The held keys go on a blur, as on a visibility change.
      ['blur', false],
    ])
    expect(documentAdd.mock.calls.map(([type]) => type)).toEqual(['visibilitychange'])
    handle.dispose()
    handle.dispose()
    expect(remove.mock.calls.map(([type, listener, options]) => [type, listener, capture(options)])).toEqual(added)
    expect(documentRemove.mock.calls.map(([type, listener]) => [type, listener]))
      .toEqual(documentAdd.mock.calls.map(([type, listener]) => [type, listener]))
  })

  it('keyState runs first for every key, and a held Space stops the key there', () => {
    install()
    host.focus()
    const field = document.createElement('input')
    document.body.append(field)
    // An element handler that takes the key still comes after keyState.
    field.addEventListener('keydown', (event) => event.preventDefault())

    press({ key: 'a', code: 'KeyA' }, field)
    press({ key: 'Escape', code: 'Escape' }, host)
    const up = new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', bubbles: true })
    host.dispatchEvent(up)
    expect(fake.port.keyState.mock.calls.map(([k]) => [k.type, k.key, k.text, k.onCanvas])).toEqual([
      ['keydown', 'a', true, false],
      ['keydown', 'Escape', false, true],
      ['keyup', 'a', false, true],
    ])

    fake.state.verdict = 'held'
    const space = press({ key: ' ', code: 'Space' }, host)
    expect(space.defaultPrevented).toBe(true)
    expect(fake.port.command).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('runs canvas-focus rows on the map and <body>, never from a control', () => {
    install()
    const button = document.createElement('button')
    document.body.append(button)

    expect(press({ key: 'ArrowRight' }, host).defaultPrevented).toBe(true)
    expect(press({ key: 'ArrowRight' }, document.body).defaultPrevented).toBe(true)
    expect(press({ key: 'ArrowRight' }, button).defaultPrevented).toBe(false)
    expect(fake.port.command.mock.calls.map(([c]) => c)).toEqual([
      { kind: 'arrow', dir: 'right', large: false },
      { kind: 'arrow', dir: 'right', large: false },
    ])
    // A refused canvas command without a fallback leaves the key to the page.
    fake.state.command = () => false
    expect(press({ key: 'ArrowRight' }, host).defaultPrevented).toBe(false)
  })

  it('a pushed scope takes its key before the keymap, outside text fields', () => {
    install()
    const handle = vi.fn((_e: unknown, chord: { key: string; mod: boolean }) => chord.key === 'z' && chord.mod)
    const scope = pushKeyScope({ id: 'stories-undo-toast', handle })
    const field = document.createElement('input')
    document.body.append(field)
    try {
      expect(press({ key: 'z', ctrlKey: true }, field).defaultPrevented).toBe(false)
      expect(handle).not.toHaveBeenCalled()
      expect(press({ key: 'z', ctrlKey: true }, host).defaultPrevented).toBe(true)
      expect(run).not.toHaveBeenCalled()
    } finally {
      scope.dispose()
    }
    press({ key: 'z', ctrlKey: true }, host)
    expect(run).toHaveBeenCalledExactlyOnceWith('edit.undo')
  })

  it('the story presenter\'s own handler runs under the modal step and no canvas key reaches the map (I12, I12b)', () => {
    install()
    const root = document.createElement('div')
    const next = document.createElement('button')
    root.append(next)
    document.body.append(root)
    const presenterKeys: string[] = []
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== ' ' && event.key !== 'Escape') return
      presenterKeys.push(event.key)
      event.preventDefault()
    })
    modal = true

    // I12: focus in the presenter.
    next.focus()
    press({ key: 'ArrowRight' }, next)
    press({ key: 'n' }, next)
    expect(presenterKeys).toEqual(['ArrowRight'])
    // I12b: focus on <body>; the presenter hears only keys inside its root.
    press({ key: 'ArrowRight' }, document.body)
    press({ key: ' ', code: 'Space' }, document.body)
    press({ key: 'Escape' }, document.body)
    expect(presenterKeys).toEqual(['ArrowRight'])

    expect(fake.port.command).not.toHaveBeenCalled()
    expect(fake.port.escape).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    // A modal holds the keys: Space is reported off the map, so the map never holds it.
    expect(fake.port.keyState.mock.calls.every(([k]) => !k.onCanvas)).toBe(true)
  })

  it('runs only the rows that work in a modal while one is open', () => {
    const palette: KeymapRow = {
      command: 'help.commandPalette',
      chords: [{ key: 'p', mod: true, ctrl: false, shift: true, alt: false }],
      scope: 'global',
      singleKey: 'n/a',
      worksInModal: true,
    }
    install({ keymap: [palette, ...CANVAS_KEYMAP_ROWS] })
    modal = true
    expect(press({ key: 'z', ctrlKey: true }, host).defaultPrevented).toBe(false)
    expect(press({ key: 'P', ctrlKey: true, shiftKey: true }, host).defaultPrevented).toBe(true)
    expect(run.mock.calls).toEqual([['help.commandPalette']])
  })

  it('a widget that handles its own arrows runs first: Shift+↑ on the scale button opens its menu (H23)', () => {
    install()
    const scale = document.createElement('button')
    let menuOpen = false
    scale.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      menuOpen = true
    })
    document.body.append(scale)
    scale.focus()

    press({ key: 'ArrowUp', shiftKey: true }, scale)

    expect(menuOpen).toBe(true)
    expect(fake.port.command).not.toHaveBeenCalled()
  })

  it('with single keys off a held stamp still turns on the map, and nothing turns from <body> (H24)', () => {
    install()
    singleKeys.value = false
    let held = true
    fake.state.command = (c) => c.kind === 'rotate-held' && held

    expect(press({ key: ']' }, host).defaultPrevented).toBe(true)
    expect(fake.port.command).toHaveBeenLastCalledWith({ kind: 'rotate-held', stepDeg: 15 })
    expect(press({ key: ']' }, document.body).defaultPrevented).toBe(false)
    expect(fake.port.command).toHaveBeenCalledOnce()
    // Nothing held: the switch keeps Bring to front off too.
    held = false
    expect(press({ key: ']' }, host).defaultPrevented).toBe(false)
    expect(run).not.toHaveBeenCalled()

    singleKeys.value = true
    expect(press({ key: ']' }, document.body).defaultPrevented).toBe(true)
    expect(run).toHaveBeenCalledExactlyOnceWith('canvas.bringToFront')
  })

  it('arrows during a live drag do nothing (H25)', () => {
    install()
    fake.state.verdict = 'pass-live'
    fake.state.command = (c) => c.kind !== 'arrow'
    const arrow = press({ key: 'ArrowRight' }, host)
    expect(fake.port.command).toHaveBeenCalledExactlyOnceWith({ kind: 'arrow', dir: 'right', large: false })
    expect(arrow.defaultPrevented).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('an arrow-owning widget outside the map keeps Shift+arrows (H26)', () => {
    install()
    const world = document.createElement('div')
    world.tabIndex = 0
    world.setAttribute('data-owns-keys', 'arrows')
    document.body.append(world)
    world.focus()

    press({ key: 'ArrowRight', shiftKey: true }, world)
    press({ key: 'ArrowUp', shiftKey: true }, world)

    expect(fake.port.command).not.toHaveBeenCalled()
  })

  it('F2 falls through to the shell when the map has no note to edit (H27)', () => {
    install()
    host.focus()
    fake.state.command = () => false
    expect(press({ key: 'F2' }, host).defaultPrevented).toBe(true)
    expect(fake.port.command).toHaveBeenLastCalledWith({ kind: 'edit-text' })
    expect(run).toHaveBeenCalledExactlyOnceWith('file.rename')

    fake.state.command = (c) => c.kind === 'edit-text'
    press({ key: 'F2' }, host)
    expect(run).toHaveBeenCalledOnce()
    // Away from the map, F2 renames the Design.
    const list = document.createElement('div')
    list.tabIndex = 0
    document.body.append(list)
    press({ key: 'F2' }, list)
    expect(run).toHaveBeenCalledTimes(2)
    expect(fake.port.command).toHaveBeenCalledTimes(2)
  })

  it('F6 reaches the next region past a widget that stops propagation (I11), never in a modal', () => {
    install()
    const lens = document.createElement('div')
    lens.tabIndex = 0
    lens.addEventListener('keydown', (event) => event.stopPropagation())
    document.body.append(lens)
    lens.focus()

    const f6 = press({ key: 'F6' }, lens)
    expect(cycleRegion).toHaveBeenCalledExactlyOnceWith(1)
    expect(f6.defaultPrevented).toBe(true)
    press({ key: 'F6', shiftKey: true }, lens)
    expect(cycleRegion).toHaveBeenLastCalledWith(-1)
    press({ key: 'F6', ctrlKey: true }, lens)
    modal = true
    press({ key: 'F6' }, lens)
    expect(cycleRegion).toHaveBeenCalledTimes(2)
  })

  it('Esc runs the Esc chain after element handlers, and before them while a drag or nudge series is live (steps 4 and 8)', () => {
    install()
    const panel = document.createElement('div')
    const row = document.createElement('li')
    row.tabIndex = 0
    panel.append(row)
    document.body.append(panel)
    // A panel that takes its own Esc.
    const panelEscape = vi.fn((event: KeyboardEvent) => event.preventDefault())
    panel.addEventListener('keydown', (event) => { if (event.key === 'Escape') panelEscape(event) })
    fake.state.layers = ['tool']

    expect(press({ key: 'Escape' }, row).defaultPrevented).toBe(true)
    expect(panelEscape).toHaveBeenCalledOnce()
    expect(fake.port.escape).not.toHaveBeenCalled()
    expect(press({ key: 'Escape' }, host).defaultPrevented).toBe(true)
    expect(fake.port.escape).toHaveBeenCalledExactlyOnceWith('tool')

    // A live drag takes the Esc first, wherever focus is, and the panel never hears it.
    fake.port.escape.mockClear()
    fake.state.verdict = 'pass-live'
    fake.state.layers = ['gesture', 'tool']
    expect(press({ key: 'Escape' }, row).defaultPrevented).toBe(true)
    expect(fake.port.escape).toHaveBeenCalledExactlyOnceWith('gesture')
    expect(panelEscape).toHaveBeenCalledOnce()
    // So does a nudge series.
    fake.port.escape.mockClear()
    fake.state.verdict = 'pass'
    fake.state.layers = ['nudge-series', 'selection']
    press({ key: 'Escape' }, row)
    expect(fake.port.escape).toHaveBeenCalledExactlyOnceWith('nudge-series')
    expect(panelEscape).toHaveBeenCalledOnce()
  })

  it('Esc in a text field or with a modifier leaves the tool and the selection alone', () => {
    install()
    const field = document.createElement('input')
    document.body.append(field)
    fake.state.layers = ['tool-transient', 'tool', 'selection']

    expect(press({ key: 'Escape' }, field).defaultPrevented).toBe(false)
    expect(press({ key: 'Escape', shiftKey: true }, host).defaultPrevented).toBe(true)
    expect(fake.port.escape).toHaveBeenCalledExactlyOnceWith('tool-transient')
    fake.state.layers = ['tool', 'selection']
    expect(press({ key: 'Escape', ctrlKey: true }, host).defaultPrevented).toBe(false)
    expect(fake.port.escape).toHaveBeenCalledOnce()
  })

  it('lets go of every held key when Meta comes up, on blur and when the page hides (H10)', () => {
    const save: KeymapRow = { command: 'file.save', chords: [{ key: 's', mod: true, ctrl: false, shift: false, alt: false }], scope: 'global', singleKey: 'n/a', worksInTextFields: true }
    install({ keymap: [save], platform: { os: 'mac', engine: 'webkit', gestureEvents: false } })
    host.focus()
    const up = (key: string, code: string) => host.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true }))
    const released = () => fake.port.keyState.mock.calls.filter(([k]) => k.type === 'keyup').map(([k]) => k.code)

    press({ key: 'Meta', code: 'MetaLeft', metaKey: true }, host)
    press({ key: 's', code: 'KeyS', metaKey: true }, host)
    // macOS sends no keyup for S while Cmd is down.
    up('Meta', 'MetaLeft')
    expect(run).toHaveBeenCalledExactlyOnceWith('file.save')
    expect(released()).toEqual(['MetaLeft', 'KeyS'])

    fake.port.keyState.mockClear()
    press({ key: ' ', code: 'Space' }, host)
    press({ key: 'Control', code: 'ControlLeft', ctrlKey: true }, host)
    window.dispatchEvent(new Event('blur'))
    expect(released()).toEqual(['Space', 'ControlLeft'])

    fake.port.keyState.mockClear()
    press({ key: ' ', code: 'Space' }, host)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(released()).toEqual(['Space'])
    // Nothing is held twice.
    window.dispatchEvent(new Event('blur'))
    expect(released()).toEqual(['Space'])
  })

  it('lets go of a Space held from before Cmd when Meta comes up, since its keyup may be lost', () => {
    install({ platform: { os: 'mac', engine: 'webkit', gestureEvents: false } })
    host.focus()
    const up = (key: string, code: string) => host.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true }))
    const released = () => fake.port.keyState.mock.calls.filter(([k]) => k.type === 'keyup').map(([k]) => k.code)

    press({ key: ' ', code: 'Space' }, host)
    press({ key: 'Meta', code: 'MetaLeft', metaKey: true }, host)
    press({ key: '=', code: 'Equal', metaKey: true }, host)
    // Space is released first, while Cmd is down: macOS drops its keyup, so the router sees only Meta's.
    up('Meta', 'MetaLeft')
    // No order of keyups tells "still held" from "released under Cmd", so Space is let go too and the next drag selects.
    expect(released()).toEqual(['MetaLeft', 'Space', 'Equal'])
  })

  it('a composing keydown runs nothing (H11, G12)', () => {
    install()
    host.focus()
    const composing = (init: KeyboardEventInit, keyCode = 229): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
      Object.defineProperty(event, 'keyCode', { value: keyCode })
      host.dispatchEvent(event)
      return event
    }
    // H11: WebKit commits a composition, then sends its Enter with keyCode 229 and isComposing false.
    host.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    composing({ key: 'Process', code: 'KeyK', isComposing: true })
    host.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    const enter = composing({ key: 'Enter', code: 'Enter' })
    // G12: Space while composing arms no pan.
    fake.state.verdict = 'held'
    const space = composing({ key: ' ', code: 'Space', isComposing: true }, 0)
    composing({ key: 'v', code: 'KeyV', isComposing: true }, 0)
    composing({ key: 'Escape', code: 'Escape', isComposing: true }, 0)
    composing({ key: 'F6', code: 'F6', isComposing: true }, 0)

    expect(fake.port.keyState).not.toHaveBeenCalled()
    expect(fake.port.command).not.toHaveBeenCalled()
    expect(fake.port.escape).not.toHaveBeenCalled()
    expect(cycleRegion).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(enter.defaultPrevented).toBe(false)
    expect(space.defaultPrevented).toBe(false)
  })

  it('without a canvas, canvas rows fall back to the shell and the rest run nowhere', () => {
    install({ canvas: () => null })
    expect(press({ key: 'F2' }, document.body).defaultPrevented).toBe(true)
    expect(run).toHaveBeenCalledExactlyOnceWith('file.rename')
    expect(press({ key: 'ArrowLeft' }, document.body).defaultPrevented).toBe(false)
    expect(press({ key: 'Escape' }, document.body).defaultPrevented).toBe(false)
  })
})
