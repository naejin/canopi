import { describe, expect, it } from 'vitest'
import { CURRENT_BINDINGS, type Bindings } from './bindings'
import { normalise, type DomEventLike } from './normalise'
import type { InputPlatform } from './platform'
import type { TargetClass } from './raw-input'

const SURFACE: TargetClass = { kind: 'surface' }
const WINDOWS: InputPlatform = { os: 'windows', gestureEvents: false }
const MAC: InputPlatform = { os: 'mac', gestureEvents: true }
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
    const pinch = normalise(event({ type: 'wheel', deltaY: -2, ctrlKey: true }), WINDOWS, CURRENT_BINDINGS, NO_CTRL, HOST)
    expect(pinch).toMatchObject({ kind: 'wheel', pinch: true, dyPx: -2, mods: { ctrl: true } })
    const real = normalise(event({ type: 'wheel', deltaY: -2, ctrlKey: true }), WINDOWS, CURRENT_BINDINGS, { physicalCtrl: true }, HOST)
    expect(real).toMatchObject({ kind: 'wheel', pinch: false, mods: { ctrl: true } })
    const plain = normalise(event({ type: 'wheel', deltaY: -2 }), WINDOWS, CURRENT_BINDINGS, NO_CTRL, HOST)
    expect(plain).toMatchObject({ kind: 'wheel', pinch: false })
  })

  it('wheel deltas in lines and pages become pixels', () => {
    const pixels = normalise(event({ type: 'wheel', deltaX: 2, deltaY: 3, deltaMode: 0 }), WINDOWS, CURRENT_BINDINGS, NO_CTRL, HOST)
    expect(pixels).toMatchObject({ dxPx: 2, dyPx: 3 })
    const lines = normalise(event({ type: 'wheel', deltaX: 2, deltaY: 3, deltaMode: 1 }), WINDOWS, CURRENT_BINDINGS, NO_CTRL, HOST)
    expect(lines).toMatchObject({ dxPx: 32, dyPx: 48 })
    const pages = normalise(event({ type: 'wheel', deltaY: 1, deltaMode: 2 }), WINDOWS, CURRENT_BINDINGS, NO_CTRL, HOST)
    expect(pages).toMatchObject({ dxPx: 0, dyPx: 300 })
  })

  it('a page of deltaX is the host width', () => {
    const pages = normalise(event({ type: 'wheel', deltaX: 0.25, deltaMode: 2 }), WINDOWS, CURRENT_BINDINGS, NO_CTRL, HOST)
    expect(pages).toMatchObject({ dxPx: 100, dyPx: 0 })
  })

  it('a Mac physical Ctrl is ctrl, never mod', () => {
    const press = normalise(event({ type: 'pointerdown', button: 0, ctrlKey: true, pointerId: 3 }), MAC, CURRENT_BINDINGS, NO_CTRL, HOST)
    expect(press).toMatchObject({
      kind: 'down',
      role: 'primary',
      ctrlConsumed: false,
      mods: { shift: false, ctrl: true, alt: false, meta: false },
    })
    const command = normalise(event({ type: 'pointerdown', button: 0, metaKey: true }), MAC, CURRENT_BINDINGS, NO_CTRL, HOST)
    expect(command).toMatchObject({ mods: { ctrl: false, meta: true } })
  })

  it('a Mac Ctrl+click becomes a consumed secondary press only when the bindings say so', () => {
    const secondaryCtrl: Bindings = { ...CURRENT_BINDINGS, macCtrlClick: 'secondary' }
    const press = normalise(event({ type: 'pointerdown', button: 0, ctrlKey: true }), MAC, secondaryCtrl, NO_CTRL, HOST)
    expect(press).toMatchObject({ kind: 'down', role: 'secondary', ctrlConsumed: true, mods: { ctrl: true } })
    const withCommand = normalise(event({ type: 'pointerdown', button: 0, ctrlKey: true, metaKey: true }), MAC, secondaryCtrl, NO_CTRL, HOST)
    expect(withCommand).toMatchObject({ role: 'primary', ctrlConsumed: false })
    const elsewhere = normalise(event({ type: 'pointerdown', button: 0, ctrlKey: true }), WINDOWS, secondaryCtrl, NO_CTRL, HOST)
    expect(elsewhere).toMatchObject({ role: 'primary' })
  })

  it('maps mouse buttons to roles and drops back and forward', () => {
    const role = (button: number) => normalise(event({ type: 'pointerdown', button }), WINDOWS, CURRENT_BINDINGS, NO_CTRL, HOST)
    expect(role(0)).toMatchObject({ role: 'primary' })
    expect(role(1)).toMatchObject({ role: 'auxiliary' })
    expect(role(2)).toMatchObject({ role: 'secondary' })
    expect(role(3)).toBeNull()
    expect(role(4)).toBeNull()
  })

  it('never drops an up: a button it would not press with is a primary release for every pointer kind', () => {
    const up = (pointerType: string, button: number) =>
      normalise(event({ type: 'pointerup', pointerType, button, pointerId: 4 }), WINDOWS, CURRENT_BINDINGS, NO_CTRL, HOST)
    // The pen's barrel under LEGACY (a drag whose tip lifted before the barrel) and its eraser end their session.
    expect(up('pen', 2)).toMatchObject({ kind: 'up', id: 4, pointer: 'pen', role: 'primary' })
    expect(up('pen', 5)).toMatchObject({ kind: 'up', pointer: 'pen', role: 'primary' })
    expect(up('mouse', 3)).toMatchObject({ kind: 'up', pointer: 'mouse', role: 'primary' })
    const barrel = normalise(event({ type: 'pointerup', pointerType: 'pen', button: 2 }), WINDOWS, { ...CURRENT_BINDINGS, penBarrel: 'secondary' }, NO_CTRL, HOST)
    expect(barrel).toMatchObject({ kind: 'up', role: 'secondary' })
  })

  it('maps the pen tip to primary and drops the barrel under LEGACY and the eraser always', () => {
    const pen = (button: number, bindings: Bindings = CURRENT_BINDINGS) =>
      normalise(event({ type: 'pointerdown', pointerType: 'pen', button }), WINDOWS, bindings, NO_CTRL, HOST)
    expect(pen(0)).toMatchObject({ pointer: 'pen', role: 'primary' })
    expect(pen(2)).toBeNull()
    expect(pen(5)).toBeNull()
    expect(pen(2, { ...CURRENT_BINDINGS, penBarrel: 'secondary' })).toMatchObject({ role: 'secondary' })
  })

  it('makes every touch primary and reads move buttons as roles', () => {
    expect(normalise(event({ type: 'pointerdown', pointerType: 'touch', button: 0 }), WINDOWS, CURRENT_BINDINGS, NO_CTRL, HOST))
      .toMatchObject({ pointer: 'touch', role: 'primary' })
    const mouseMove = normalise(event({ type: 'pointermove', buttons: 7 }), WINDOWS, CURRENT_BINDINGS, NO_CTRL, HOST)
    expect(mouseMove?.kind === 'move' ? [...mouseMove.buttons].sort() : null).toEqual(['auxiliary', 'primary', 'secondary'])
    const penMove = normalise(event({ type: 'pointermove', pointerType: 'pen', buttons: 34 }), WINDOWS, CURRENT_BINDINGS, NO_CTRL, HOST)
    expect(penMove?.kind === 'move' ? [...penMove.buttons] : null).toEqual([])
  })

  it('keeps the pointer id, detail and host-relative point of a press', () => {
    expect(normalise(event({ type: 'pointerdown', pointerId: 9, detail: 2 }), WINDOWS, CURRENT_BINDINGS, NO_CTRL, HOST)).toEqual({
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
      normalise(event(overrides), WINDOWS, CURRENT_BINDINGS, NO_CTRL, HOST)
    expect(raw({ type: 'pointerup', pointerId: 2, button: 0 })).toMatchObject({ kind: 'up', id: 2, role: 'primary', target: SURFACE })
    expect(raw({ type: 'pointercancel', pointerId: 2 })).toEqual({ kind: 'cancel', t: 10, id: 2, reason: 'pointercancel' })
    expect(raw({ type: 'lostpointercapture', pointerId: 2 })).toEqual({ kind: 'cancel', t: 10, id: 2, reason: 'lost-capture' })
    expect(raw({ type: 'pointerleave' })).toEqual({ kind: 'leave', t: 10 })
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
