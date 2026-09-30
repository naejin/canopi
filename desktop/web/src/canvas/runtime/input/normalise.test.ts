import { describe, expect, it } from 'vitest'
import { LEGACY_BINDINGS, type Bindings } from './bindings'
import { normalise, type DomEventLike } from './normalise'
import type { InputPlatform } from './platform'
import type { TargetClass } from './raw-input'

const SURFACE: TargetClass = { kind: 'surface' }
const WINDOWS: InputPlatform = { os: 'windows', engine: 'chromium', gestureEvents: false }
const MAC: InputPlatform = { os: 'mac', engine: 'webkit', gestureEvents: true }
const HOST = { width: 400, height: 300 }
const NO_CTRL = { physicalCtrl: false }

function event(overrides: Partial<DomEventLike> & Pick<DomEventLike, 'type'>): DomEventLike {
  return {
    timeStamp: 10,
    clientX: 12,
    clientY: 34,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    target: SURFACE,
    ...overrides,
  }
}

describe('normalise', () => {
  it('a Ctrl+wheel with no physical Ctrl is a pinch', () => {
    const pinch = normalise(event({ type: 'wheel', deltaY: -2, ctrlKey: true }), WINDOWS, LEGACY_BINDINGS, NO_CTRL, HOST)
    expect(pinch).toMatchObject({ kind: 'wheel', pinch: true, dyPx: -2, mods: { ctrl: true } })
    const real = normalise(event({ type: 'wheel', deltaY: -2, ctrlKey: true }), WINDOWS, LEGACY_BINDINGS, { physicalCtrl: true }, HOST)
    expect(real).toMatchObject({ kind: 'wheel', pinch: false, mods: { ctrl: true } })
    const plain = normalise(event({ type: 'wheel', deltaY: -2 }), WINDOWS, LEGACY_BINDINGS, NO_CTRL, HOST)
    expect(plain).toMatchObject({ kind: 'wheel', pinch: false })
  })

  it('wheel deltas in lines and pages become pixels', () => {
    const pixels = normalise(event({ type: 'wheel', deltaX: 2, deltaY: 3, deltaMode: 0 }), WINDOWS, LEGACY_BINDINGS, NO_CTRL, HOST)
    expect(pixels).toMatchObject({ dxPx: 2, dyPx: 3 })
    const lines = normalise(event({ type: 'wheel', deltaX: 2, deltaY: 3, deltaMode: 1 }), WINDOWS, LEGACY_BINDINGS, NO_CTRL, HOST)
    expect(lines).toMatchObject({ dxPx: 32, dyPx: 48 })
    const pages = normalise(event({ type: 'wheel', deltaY: 1, deltaMode: 2 }), WINDOWS, LEGACY_BINDINGS, NO_CTRL, HOST)
    expect(pages).toMatchObject({ dxPx: 0, dyPx: 300 })
  })

  it('a page of deltaX is the host width', () => {
    const pages = normalise(event({ type: 'wheel', deltaX: 0.25, deltaMode: 2 }), WINDOWS, LEGACY_BINDINGS, NO_CTRL, HOST)
    expect(pages).toMatchObject({ dxPx: 100, dyPx: 0 })
  })

  it('a Mac physical Ctrl is ctrl, never mod', () => {
    const press = normalise(event({ type: 'pointerdown', button: 0, ctrlKey: true, pointerId: 3 }), MAC, LEGACY_BINDINGS, NO_CTRL, HOST)
    expect(press).toMatchObject({
      kind: 'down',
      role: 'primary',
      ctrlConsumed: false,
      mods: { shift: false, ctrl: true, alt: false, meta: false },
    })
    const command = normalise(event({ type: 'pointerdown', button: 0, metaKey: true }), MAC, LEGACY_BINDINGS, NO_CTRL, HOST)
    expect(command).toMatchObject({ mods: { ctrl: false, meta: true } })
  })

  it('a Mac Ctrl+click becomes a consumed secondary press only when the bindings say so', () => {
    const secondaryCtrl: Bindings = { ...LEGACY_BINDINGS, macCtrlClick: 'secondary' }
    const press = normalise(event({ type: 'pointerdown', button: 0, ctrlKey: true }), MAC, secondaryCtrl, NO_CTRL, HOST)
    expect(press).toMatchObject({ kind: 'down', role: 'secondary', ctrlConsumed: true, mods: { ctrl: true } })
    const withCommand = normalise(event({ type: 'pointerdown', button: 0, ctrlKey: true, metaKey: true }), MAC, secondaryCtrl, NO_CTRL, HOST)
    expect(withCommand).toMatchObject({ role: 'primary', ctrlConsumed: false })
    const elsewhere = normalise(event({ type: 'pointerdown', button: 0, ctrlKey: true }), WINDOWS, secondaryCtrl, NO_CTRL, HOST)
    expect(elsewhere).toMatchObject({ role: 'primary' })
  })

  it('maps mouse buttons to roles and drops back and forward', () => {
    const role = (button: number) => normalise(event({ type: 'pointerdown', button }), WINDOWS, LEGACY_BINDINGS, NO_CTRL, HOST)
    expect(role(0)).toMatchObject({ role: 'primary' })
    expect(role(1)).toMatchObject({ role: 'auxiliary' })
    expect(role(2)).toMatchObject({ role: 'secondary' })
    expect(role(3)).toBeNull()
    expect(role(4)).toBeNull()
  })

  it('makes a mouse or pen press of any button on a ruler primary and drops touch presses there', () => {
    const ruler: TargetClass = { kind: 'ruler', axis: 'v' }
    const press = (button: number, pointerType = 'mouse') =>
      normalise(event({ type: 'pointerdown', button, pointerType, target: ruler }), WINDOWS, LEGACY_BINDINGS, NO_CTRL, HOST)
    for (const button of [0, 1, 2, 3, 4]) expect(press(button)).toMatchObject({ kind: 'down', role: 'primary', target: ruler })
    // Today's ruler heard the pen's compatibility mousedown, barrel included.
    for (const button of [0, 2]) expect(press(button, 'pen')).toMatchObject({ kind: 'down', pointer: 'pen', role: 'primary', target: ruler })
    expect(press(0, 'touch')).toBeNull()
    const backUp = normalise(event({ type: 'pointerup', button: 3 }), WINDOWS, LEGACY_BINDINGS, NO_CTRL, HOST)
    expect(backUp).toMatchObject({ kind: 'up', role: 'primary' })
    expect(normalise(event({ type: 'pointerup', pointerType: 'pen', button: 5 }), WINDOWS, LEGACY_BINDINGS, NO_CTRL, HOST)).toBeNull()
  })

  it('maps the pen tip to primary and drops the barrel under LEGACY and the eraser always', () => {
    const pen = (button: number, bindings: Bindings = LEGACY_BINDINGS) =>
      normalise(event({ type: 'pointerdown', pointerType: 'pen', button }), WINDOWS, bindings, NO_CTRL, HOST)
    expect(pen(0)).toMatchObject({ pointer: 'pen', role: 'primary' })
    expect(pen(2)).toBeNull()
    expect(pen(5)).toBeNull()
    expect(pen(2, { ...LEGACY_BINDINGS, penBarrel: 'secondary' })).toMatchObject({ role: 'secondary' })
  })

  it('makes every touch primary and reads move buttons as roles', () => {
    expect(normalise(event({ type: 'pointerdown', pointerType: 'touch', button: 0 }), WINDOWS, LEGACY_BINDINGS, NO_CTRL, HOST))
      .toMatchObject({ pointer: 'touch', role: 'primary' })
    const mouseMove = normalise(event({ type: 'pointermove', buttons: 7 }), WINDOWS, LEGACY_BINDINGS, NO_CTRL, HOST)
    expect(mouseMove?.kind === 'move' ? [...mouseMove.buttons].sort() : null).toEqual(['auxiliary', 'primary', 'secondary'])
    const penMove = normalise(event({ type: 'pointermove', pointerType: 'pen', buttons: 34 }), WINDOWS, LEGACY_BINDINGS, NO_CTRL, HOST)
    expect(penMove?.kind === 'move' ? [...penMove.buttons] : null).toEqual([])
  })

  it('keeps the pointer id, detail and host-relative point of a press', () => {
    expect(normalise(event({ type: 'pointerdown', pointerId: 9, detail: 2 }), WINDOWS, LEGACY_BINDINGS, NO_CTRL, HOST)).toEqual({
      kind: 'down',
      t: 10,
      id: 9,
      pointer: 'mouse',
      role: 'primary',
      at: { x: 12, y: 34 },
      mods: { shift: false, ctrl: false, alt: false, meta: false },
      target: SURFACE,
      detail: 2,
      ctrlConsumed: false,
    })
  })

  it('turns the other event types into their raw inputs', () => {
    const raw = (overrides: Partial<DomEventLike> & Pick<DomEventLike, 'type'>) =>
      normalise(event(overrides), WINDOWS, LEGACY_BINDINGS, NO_CTRL, HOST)
    expect(raw({ type: 'pointerup', pointerId: 2, button: 0 })).toMatchObject({ kind: 'up', id: 2, role: 'primary' })
    expect(raw({ type: 'pointercancel', pointerId: 2 })).toEqual({ kind: 'cancel', t: 10, id: 2, reason: 'pointercancel' })
    expect(raw({ type: 'lostpointercapture', pointerId: 2 })).toEqual({ kind: 'cancel', t: 10, id: 2, reason: 'lost-capture' })
    expect(raw({ type: 'pointerleave' })).toEqual({ kind: 'leave', t: 10 })
    expect(raw({ type: 'focusout' })).toEqual({ kind: 'focus-out', t: 10 })
    expect(raw({ type: 'contextmenu' })).toMatchObject({ kind: 'native-contextmenu', at: { x: 12, y: 34 }, fromKeyboard: false })
    expect(raw({ type: 'contextmenu', fromKeyboard: true })).toMatchObject({ kind: 'native-contextmenu', at: null, fromKeyboard: true })
    expect(raw({ type: 'gesturechange', scale: 1.5, rotation: 12 })).toMatchObject({ kind: 'platform-gesture', phase: 'change', scale: 1.5, rotationDeg: 12 })
    expect(raw({ type: 'gesturestart' })).toMatchObject({ phase: 'start', scale: 1, rotationDeg: 0 })
    expect(raw({ type: 'gestureend' })).toMatchObject({ phase: 'end' })
    expect(raw({ type: 'dragover' })).toMatchObject({ kind: 'drop', phase: 'over', payload: { kind: 'unknown' } })
    expect(raw({ type: 'dragleave' })).toMatchObject({ kind: 'drop', phase: 'leave' })
    expect(raw({ type: 'drop', dropPayload: { kind: 'species', species: null } }))
      .toMatchObject({ kind: 'drop', phase: 'drop', payload: { kind: 'species', species: null } })
  })
})
