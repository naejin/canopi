import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureWindowErrors } from '../../../__tests__/support/scene-interaction-setup'
import {
  createSceneInteractionEventHarness,
  type SceneInteractionEventHarness,
} from '../../../__tests__/support/scene-interaction-events'
import { writePlantStampDragData } from '../../plant-stamp-source'
import type { DomInputSourceDeps } from '../interaction-ports'
import { LEGACY_BINDINGS, type Bindings } from './bindings'
import { createDomInputSource, outcomeEffects } from './dom-input-source'
import type { RawInput } from './raw-input'

const PLATFORM = { os: 'linux', engine: 'webkitgtk', gestureEvents: false } as const

let host: HTMLDivElement
let events: SceneInteractionEventHarness
let received: RawInput[]

beforeEach(() => {
  host = document.createElement('div')
  host.setAttribute('style', 'position: relative; cursor: default;')
  document.body.appendChild(host)
  events = createSceneInteractionEventHarness(host, { bounds: { left: 10, top: 20, width: 400, height: 300 } })
  received = []
})

afterEach(() => {
  events.dispose()
  host.remove()
  document.body.innerHTML = ''
})

function deps(overrides: Partial<DomInputSourceDeps> = {}): DomInputSourceDeps {
  return {
    host,
    platform: PLATFORM,
    bindings: () => LEGACY_BINDINGS,
    keys: { physicalCtrl: () => false, lastKeyboardMenuAt: () => null },
    clock: () => 1000,
    timers: { set: vi.fn(() => 1), clear: vi.fn() },
    listensToRulers: false,
    ...overrides,
  }
}

function attachRecording(source: ReturnType<typeof createDomInputSource>, onInput?: (input: RawInput) => void): () => void {
  return source.attach((input) => {
    received.push(input)
    onInput?.(input)
  })
}

function listenerCalls(spy: { mock: { calls: unknown[][] } }): Array<[string, unknown, unknown]> {
  return spy.mock.calls.map((call) => [call[0] as string, call[1], call[2]])
}

function captureFlag(options: unknown): boolean {
  return typeof options === 'boolean' ? options : Boolean((options as { capture?: boolean } | undefined)?.capture)
}

describe('createDomInputSource', () => {
  it('installs and removes each listener exactly once', () => {
    const spies = {
      hostAdd: vi.spyOn(host, 'addEventListener'),
      hostRemove: vi.spyOn(host, 'removeEventListener'),
      windowAdd: vi.spyOn(window, 'addEventListener'),
      windowRemove: vi.spyOn(window, 'removeEventListener'),
      documentAdd: vi.spyOn(document, 'addEventListener'),
      documentRemove: vi.spyOn(document, 'removeEventListener'),
    }
    const source = createDomInputSource(deps({
      legacyKeys: { keydown: vi.fn(), keyup: vi.fn() },
      listensToRulers: true,
    }))
    const dispose = attachRecording(source)

    const hostAdds = listenerCalls(spies.hostAdd)
    expect(hostAdds.map(([type, , options]) => [type, captureFlag(options)])).toEqual([
      ['pointerdown', true],
      ['pointerleave', false],
      ['lostpointercapture', false],
      ['contextmenu', false],
      ['wheel', false],
      ['dragover', false],
      ['dragleave', false],
      ['drop', false],
      ['focusout', false],
    ])
    expect(hostAdds.find(([type]) => type === 'wheel')?.[2]).toEqual({ passive: false })
    const windowAdds = listenerCalls(spies.windowAdd)
    expect(windowAdds.map(([type, , options]) => [type, captureFlag(options)])).toEqual([
      ['pointermove', true],
      ['pointerup', true],
      ['pointercancel', true],
      ['keydown', true],
      ['keyup', false],
      ['blur', false],
    ])
    expect(listenerCalls(spies.documentAdd).map(([type, , options]) => [type, captureFlag(options)])).toEqual([['pointerdown', true]])

    dispose()
    dispose()

    for (const [add, remove] of [
      [spies.hostAdd, spies.hostRemove],
      [spies.windowAdd, spies.windowRemove],
      [spies.documentAdd, spies.documentRemove],
    ] as const) {
      const added = listenerCalls(add)
      const removed = listenerCalls(remove)
      expect(removed.map(([type, listener, options]) => [type, listener, captureFlag(options)]))
        .toEqual(added.map(([type, listener, options]) => [type, listener, captureFlag(options)]))
    }
    for (const spy of Object.values(spies)) spy.mockRestore()
  })

  it('installs no key listener without its sink, and no ruler listener unless told to listen', () => {
    const windowAdd = vi.spyOn(window, 'addEventListener')
    const documentAdd = vi.spyOn(document, 'addEventListener')
    const dispose = attachRecording(createDomInputSource(deps()))
    expect(listenerCalls(windowAdd).map(([type]) => type)).toEqual(['pointermove', 'pointerup', 'pointercancel', 'blur'])
    expect(listenerCalls(documentAdd)).toEqual([])
    dispose()
    windowAdd.mockRestore()
    documentAdd.mockRestore()
  })

  it('removes every listener it added when one installation fails', () => {
    const failure = new Error('wheel installation failed')
    const originalAdd = host.addEventListener.bind(host)
    const hostAdd = vi.spyOn(host, 'addEventListener').mockImplementation(((type: string, listener: EventListener, options?: AddEventListenerOptions) => {
      if (type === 'wheel') throw failure
      originalAdd(type, listener, options)
    }) as typeof host.addEventListener)
    const windowRemove = vi.spyOn(window, 'removeEventListener')
    const hostRemove = vi.spyOn(host, 'removeEventListener')

    expect(() => createDomInputSource(deps()).attach(() => {})).toThrow(failure)
    expect(listenerCalls(hostRemove).map(([type]) => type)).toEqual(['pointerdown', 'pointerleave', 'lostpointercapture', 'contextmenu'])
    expect(listenerCalls(windowRemove).map(([type]) => type)).toEqual(['pointermove', 'pointerup', 'pointercancel', 'blur'])
    for (const spy of [hostAdd, windowRemove, hostRemove]) spy.mockRestore()
  })

  it('a ruler press of any mouse button becomes a ruler target', () => {
    const ruler = document.createElement('canvas')
    ruler.dataset.canvasRuler = 'v'
    document.body.appendChild(ruler)
    const dispose = attachRecording(createDomInputSource(deps({ listensToRulers: true })))

    for (const button of [0, 1, 2, 3, 4]) events.pointerDownClient({ x: 15, y: 120 }, { target: ruler, button, pointerId: 5 })
    events.pointerDownClient({ x: 15, y: 120 }, { target: ruler, pointerType: 'pen', pointerId: 6 })
    events.pointerDownClient({ x: 15, y: 120 }, { target: ruler, pointerType: 'touch', pointerId: 7 })

    // A pen press is one too (today's ruler heard its compatibility mousedown); a touch press is dropped.
    expect(received.map((input) => input.kind === 'down' && [input.role, input.target, input.at])).toEqual(
      Array(6).fill(['primary', { kind: 'ruler', axis: 'v' }, { x: 5, y: 100 }]),
    )
    expect(received[5]).toMatchObject({ pointer: 'pen', id: 6 })
    // A press inside the map is the host listener's alone.
    events.pointerDown({ x: 50, y: 50 })
    expect(received).toHaveLength(7)
    expect(received[6]).toMatchObject({ kind: 'down', target: { kind: 'surface' } })
    dispose()
  })

  it('reads host-relative points and keeps a captured session\'s press rect', () => {
    const source = createDomInputSource(deps())
    const dispose = attachRecording(source, (input) => {
      if (input.kind === 'down') source.apply([{ kind: 'capture', pointerId: input.id }])
    })

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 12 })
    events.setBounds({ left: 30, top: 40, width: 400, height: 300 })
    events.pointerMoveClient({ x: 55, y: 75 }, { pointerId: 12, buttons: 1 })
    events.pointerMoveClient({ x: 55, y: 75 }, { pointerId: 13 })

    expect(received.map((input) => 'at' in input ? input.at : null)).toEqual([
      { x: 20, y: 30 },
      { x: 45, y: 55 },
      { x: 25, y: 35 },
    ])
    expect(events.pointerCapture.setCalls).toHaveBeenCalledWith(12)
    dispose()
  })

  it('classifies targets from data attributes', () => {
    const child = (html: string): HTMLElement => {
      const wrapper = document.createElement('div')
      wrapper.innerHTML = html
      const element = wrapper.firstElementChild as HTMLElement
      host.appendChild(element)
      return element
    }
    const plainHandle = child('<div data-canvas-handle="vertex:zone-1:2"></div>')
    const rotation = child('<div data-canvas-handle="rotate"><span data-canvas-handle-readout="true">+15°</span></div>')
    const controlPoint = child('<button data-canvas-handle="rect-corner:zone-1:ne"></button>')
    const editor = child('<textarea data-annotation-inline-editor="true" data-preserve-overlays="true"></textarea>')
    const unlock = child('<div data-locked-object-affordance="true"><span>Locked</span><button>Unlock</button></div>')
    const chrome = child('<div data-canvas-chrome><span>©</span></div>')
    const surface = child('<canvas></canvas>')
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    const dispose = attachRecording(createDomInputSource(deps()))

    for (const target of [
      plainHandle,
      rotation.firstElementChild!,
      controlPoint,
      editor,
      unlock.firstElementChild!,
      unlock.lastElementChild!,
      chrome.firstElementChild!,
      surface,
      host,
      outside,
    ]) {
      events.pointerMove({ x: 5, y: 5 }, { target })
    }

    expect(received.map((input) => input.kind === 'move' && input.target)).toEqual([
      { kind: 'handle', id: 'vertex:zone-1:2' },
      { kind: 'handle', id: 'rotate' },
      { kind: 'handle', id: 'rect-corner:zone-1:ne' },
      { kind: 'owned-text' },
      { kind: 'owned-chrome', lockedAffordance: true },
      { kind: 'owned-chrome', lockedAffordance: true },
      { kind: 'owned-chrome' },
      { kind: 'surface' },
      { kind: 'surface' },
      { kind: 'foreign' },
    ])

    // An up carries its target too: the session keeps today's release cleanup off the note editor, a handle and the
    // Unlock affordance by it.
    received.length = 0
    for (const target of [editor, plainHandle, unlock.lastElementChild!, surface]) events.pointerUp({ x: 5, y: 5 }, { target })
    expect(received.map((input) => input.kind === 'up' && input.target)).toEqual([
      { kind: 'owned-text' },
      { kind: 'handle', id: 'vertex:zone-1:2' },
      { kind: 'owned-chrome', lockedAffordance: true },
      { kind: 'surface' },
    ])
    dispose()
  })

  it('leaves text fields, menus and dialogs their own contextmenu and wheel', () => {
    const field = document.createElement('input')
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inDialog = document.createElement('span')
    dialog.appendChild(inDialog)
    host.append(field, dialog)
    const dispose = attachRecording(createDomInputSource(deps()))

    for (const target of [field, inDialog]) {
      const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      target.dispatchEvent(menu)
      const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 10 })
      target.dispatchEvent(wheel)
      expect(menu.defaultPrevented).toBe(false)
      expect(wheel.defaultPrevented).toBe(false)
    }
    expect(received).toEqual([])
    events.wheel({ x: 5, y: 5 }, { deltaY: 10 })
    expect(received.map((input) => input.kind)).toEqual(['wheel'])
    dispose()
  })

  it('marks a contextmenu inside the keyboard menu\'s echo window as fromKeyboard', () => {
    let lastKeyboardMenuAt: number | null = null
    const dispose = attachRecording(createDomInputSource(deps({
      keys: { physicalCtrl: () => false, lastKeyboardMenuAt: () => lastKeyboardMenuAt },
    })))
    const openMenu = (): void => {
      host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }))
    }

    openMenu()
    const at = received[0]!.t
    lastKeyboardMenuAt = at - 100
    openMenu()
    lastKeyboardMenuAt = at - 1000
    openMenu()

    expect(received.map((input) => input.kind === 'native-contextmenu' && input.fromKeyboard)).toEqual([false, true, false])
    expect(received[0]).toMatchObject({ at: { x: 20, y: 20 } })
    dispose()
  })

  it('a quarantine outcome prevents and stops the event', () => {
    const source = createDomInputSource(deps())
    const dispose = attachRecording(source, () => source.apply(outcomeEffects([], { quarantine: true })))
    const downstream = vi.fn()
    host.addEventListener('contextmenu', downstream)

    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    host.dispatchEvent(menu)

    expect(menu.defaultPrevented).toBe(true)
    expect(downstream).not.toHaveBeenCalled()
    host.removeEventListener('contextmenu', downstream)
    dispose()
  })

  it('a drop outcome sets dataTransfer.dropEffect', () => {
    const source = createDomInputSource(deps())
    const dispose = attachRecording(source, () => source.apply(outcomeEffects([{ kind: 'prevent-default' }], { dropEffect: 'copy' })))
    const data = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      get types() { return [...data.keys()] },
      setData(type: string, value: string) { data.set(type, value) },
      getData(type: string) { return data.get(type) ?? '' },
    }
    writePlantStampDragData(dataTransfer, { canonical_name: 'Pyrus communis', common_name: 'Pear', stratum: 'mid', width_max_m: 3 })
    const drag = (type: string): DragEvent => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
      Object.defineProperties(event, {
        clientX: { configurable: true, value: 80 },
        clientY: { configurable: true, value: 90 },
        dataTransfer: { configurable: true, value: dataTransfer },
      })
      host.dispatchEvent(event)
      return event
    }

    const over = drag('dragover')
    expect(over.defaultPrevented).toBe(true)
    expect(dataTransfer.dropEffect).toBe('copy')
    drag('drop')

    expect(received).toEqual([
      expect.objectContaining({ kind: 'drop', phase: 'over', at: { x: 70, y: 70 }, payload: { kind: 'species', species: null } }),
      expect.objectContaining({
        kind: 'drop',
        phase: 'drop',
        payload: { kind: 'species', species: expect.objectContaining({ canonical_name: 'Pyrus communis' }) },
      }),
    ])
    dispose()
  })

  it('a rejected press takes no capture', () => {
    const source = createDomInputSource(deps())
    const dispose = attachRecording(source, (input) => {
      if (input.kind !== 'down') return
      source.apply(outcomeEffects(
        [{ kind: 'prevent-default' }, { kind: 'capture', pointerId: input.id }],
        { quarantine: true, rejectSession: true },
      ))
    })
    const downstream = vi.fn()
    host.addEventListener('pointerdown', downstream)

    const press = events.pointerDown({ x: 10, y: 10 })

    expect(events.pointerCapture.setCalls).not.toHaveBeenCalled()
    expect(press.defaultPrevented).toBe(true)
    expect(downstream).not.toHaveBeenCalled()
    host.removeEventListener('pointerdown', downstream)
    dispose()
  })

  it('a throwing sink quarantines, then rethrows', () => {
    const failure = new Error('sink failed')
    const dispose = createDomInputSource(deps()).attach(() => {
      throw failure
    })
    const downstream = vi.fn()
    host.addEventListener('pointerdown', downstream)

    let press: PointerEvent | null = null
    const errors = captureWindowErrors(() => {
      press = events.pointerDown({ x: 10, y: 10 })
    })

    expect(errors).toEqual([failure])
    expect(press!.defaultPrevented).toBe(true)
    expect(downstream).not.toHaveBeenCalled()
    host.removeEventListener('pointerdown', downstream)
    dispose()
  })

  it('a sink that throws on any other event rethrows and leaves the event to the app, as today', () => {
    const failure = new Error('sink failed')
    const dispose = createDomInputSource(deps()).attach(() => {
      throw failure
    })
    const panel = document.createElement('div')
    document.body.appendChild(panel)
    const heard: string[] = []
    const removals: Array<() => void> = []
    const listen = (target: EventTarget, type: string): void => {
      const listener = (event: Event): void => { heard.push(`${type}:${event.defaultPrevented}`) }
      target.addEventListener(type, listener)
      removals.push(() => target.removeEventListener(type, listener))
    }
    listen(panel, 'pointermove')
    listen(panel, 'pointercancel')
    listen(host, 'pointerleave')
    listen(host, 'wheel')
    listen(window, 'blur')

    let errors: unknown[] = []
    try {
      errors = captureWindowErrors(() => {
        events.pointerMove({ x: 10, y: 10 }, { target: panel })
        events.pointerCancel({ x: 10, y: 10 }, { target: panel })
        events.pointerLeave({ x: 10, y: 10 })
        events.wheel({ x: 10, y: 10 }, { deltaY: 4 })
        events.windowBlur()
      })
    } finally {
      for (const remove of removals) remove()
      panel.remove()
      dispose()
    }

    // Today only a press on the map, a release, the context menu, dragover and drop were quarantined when they failed.
    expect(errors).toEqual([failure, failure, failure, failure, failure])
    expect(heard).toEqual(['pointermove:false', 'pointercancel:false', 'pointerleave:false', 'wheel:false', 'blur:false'])
  })

  it('a sink that throws on a release, a menu, a dragover or a drop quarantines it, then rethrows', () => {
    const failure = new Error('sink failed')
    const dispose = createDomInputSource(deps()).attach(() => {
      throw failure
    })
    const downstream = vi.fn()
    for (const type of ['pointerup', 'contextmenu', 'dragover', 'drop']) window.addEventListener(type, downstream)

    const handled: Event[] = []
    let errors: unknown[] = []
    try {
      errors = captureWindowErrors(() => {
        handled.push(events.pointerUp({ x: 10, y: 10 }))
        for (const type of ['contextmenu', 'dragover', 'drop']) {
          const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 20, clientY: 30 })
          host.dispatchEvent(event)
          handled.push(event)
        }
      })
    } finally {
      for (const type of ['pointerup', 'contextmenu', 'dragover', 'drop']) window.removeEventListener(type, downstream)
      dispose()
    }

    expect(errors).toEqual([failure, failure, failure, failure])
    expect(handled.map((event) => event.defaultPrevented)).toEqual([true, true, true, true])
    expect(downstream).not.toHaveBeenCalled()
  })

  it('pointerleave becomes leave and focusout becomes focus-out', () => {
    const dispose = attachRecording(createDomInputSource(deps()))
    const inside = document.createElement('button')
    host.appendChild(inside)

    events.pointerLeave({ x: 0, y: 0 })
    host.dispatchEvent(new FocusEvent('focusout', { relatedTarget: document.body }))
    // Focus moving to the note editor or a handle stays in the map.
    host.dispatchEvent(new FocusEvent('focusout', { relatedTarget: inside }))
    window.dispatchEvent(new Event('blur'))

    expect(received.map((input) => input.kind === 'cancel' ? `${input.kind}:${String(input.id)}:${input.reason}` : input.kind))
      .toEqual(['leave', 'focus-out', 'cancel:all:blur'])
    dispose()
  })

  it('forwards a lost capture only for a pointer the host holds, and a release makes its own loss stale', () => {
    events.dispose()
    events = createSceneInteractionEventHarness(host, { pointerCapture: { synchronousLossOnRelease: true } })
    const source = createDomInputSource(deps())
    const dispose = attachRecording(source, (input) => {
      if (input.kind === 'down') source.apply([{ kind: 'capture', pointerId: input.id }])
      if (input.kind === 'up') source.apply([{ kind: 'release-capture', pointerId: input.id }])
    })

    events.lostPointerCapture(4)
    events.pointerDown({ x: 10, y: 10 }, { pointerId: 4 })
    events.pointerUp({ x: 10, y: 10 }, { pointerId: 4 })
    events.pointerDown({ x: 10, y: 10 }, { pointerId: 4 })
    events.lostPointerCapture(4)

    expect(received.map((input) => input.kind === 'cancel' ? input.reason : input.kind)).toEqual(['down', 'up', 'down', 'lost-capture'])
    expect(events.pointerCapture.releaseCalls).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('a synchronous loss while capturing is forwarded and the capture is not kept', () => {
    events.dispose()
    events = createSceneInteractionEventHarness(host, { pointerCapture: { synchronousLossOnSet: true } })
    const source = createDomInputSource(deps())
    const dispose = attachRecording(source, (input) => {
      if (input.kind === 'down') source.apply([{ kind: 'capture', pointerId: input.id }])
    })

    events.pointerDown({ x: 10, y: 10 }, { pointerId: 8 })
    events.lostPointerCapture(8)

    expect(received.map((input) => input.kind === 'cancel' ? input.reason : input.kind)).toEqual(['down', 'lost-capture'])
    dispose()
  })

  it('detach releases every capture the source holds, before its own loss can reach a sink', () => {
    events.dispose()
    events = createSceneInteractionEventHarness(host, { pointerCapture: { synchronousLossOnRelease: true } })
    const source = createDomInputSource(deps())
    const dispose = attachRecording(source, (input) => {
      if (input.kind === 'down') source.apply([{ kind: 'capture', pointerId: input.id }])
    })

    events.pointerDown({ x: 10, y: 10 }, { pointerId: 5 })
    events.pointerDown({ x: 20, y: 20 }, { pointerId: 6 })
    source.apply([{ kind: 'release-capture', pointerId: 6 }])
    expect(events.pointerCapture.has(5)).toBe(true)
    dispose()

    expect(events.pointerCapture.releaseCalls.mock.calls).toEqual([[6], [5]])
    expect(events.pointerCapture.has(5)).toBe(false)
    expect(received.map((input) => input.kind)).toEqual(['down', 'down'])
  })

  it('hands the legacy key sink each key event as the current event', () => {
    const seen: Array<[string, Event | null]> = []
    const source = createDomInputSource(deps({
      legacyKeys: {
        keydown: (event) => seen.push([`down:${event.key}`, source.currentEvent()]),
        keyup: (event) => seen.push([`up:${event.key}`, source.currentEvent()]),
      },
    }))
    const dispose = attachRecording(source)
    const down = events.keyDown('a')
    const up = events.keyUp('a')

    expect(seen).toEqual([['down:a', down], ['up:a', up]])
    expect(source.currentEvent()).toBeNull()
    dispose()
  })

  it('delivers a tick when a timer effect fires', () => {
    let fire: (() => void) | null = null
    const timers = { set: vi.fn((_at: number, callback: () => void) => { fire = callback; return 7 }), clear: vi.fn() }
    const source = createDomInputSource(deps({ timers }))
    const dispose = attachRecording(source)

    source.apply([{ kind: 'set-timer', atMs: 1500 }])
    source.apply([{ kind: 'set-timer', atMs: 1600 }])
    expect(timers.clear).toHaveBeenCalledWith(7)
    fire!()
    source.apply([{ kind: 'clear-timer' }])

    expect(received).toEqual([{ kind: 'tick', t: 1000 }])
    expect(timers.set).toHaveBeenLastCalledWith(1600, expect.any(Function))
    dispose()
  })

  it('host CSS is unchanged under LEGACY', () => {
    const before = host.getAttribute('style')
    const source = createDomInputSource(deps())
    const dispose = attachRecording(source, (input) => {
      if (input.kind === 'down') source.apply([{ kind: 'prevent-default' }, { kind: 'capture', pointerId: input.id }])
      if (input.kind === 'up') source.apply([{ kind: 'release-capture', pointerId: input.id }])
    })
    events.pointerDown({ x: 10, y: 10 })
    events.pointerMove({ x: 20, y: 10 }, { buttons: 1 })
    events.pointerUp({ x: 20, y: 10 })
    events.wheel({ x: 20, y: 10 }, { deltaY: 5 })
    expect(host.getAttribute('style')).toBe(before)
    dispose()
    expect(host.getAttribute('style')).toBe(before)

    // A binding with touch gestures takes the host's touch-action for the time it is attached.
    const touch: Bindings = { ...LEGACY_BINDINGS, touch: { gestures: true, longPressMenu: true, hostTouchActionNone: true } }
    const detach = createDomInputSource(deps({ bindings: () => touch })).attach(() => {})
    expect(host.style.touchAction).toBe('none')
    detach()
    expect(host.getAttribute('style')).toBe(before)
  })

  it('rejects a second attach while attached', () => {
    const source = createDomInputSource(deps())
    const dispose = source.attach(() => {})
    expect(() => source.attach(() => {})).toThrow('already attached')
    dispose()
    source.attach(() => {})()
  })
})
