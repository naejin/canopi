import { describe, expect, it } from 'vitest'
import { normalise, type DomEventLike } from './normalise'
import type { InputPlatform } from './platform'
import type { TargetClass } from './raw-input'

const SURFACE: TargetClass = { kind: 'surface' }
const WINDOWS: InputPlatform = { os: 'windows', gestureEvents: false }
const MAC: InputPlatform = { os: 'mac', gestureEvents: true }
const HOST = { width: 400, height: 300 }

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
  it('wheel deltas in lines and pages become pixels', () => {
    const pixels = normalise(event({ type: 'wheel', deltaX: 2, deltaY: 3, deltaMode: 0 }), WINDOWS, HOST)
    expect(pixels).toMatchObject({ dxPx: 2, dyPx: 3 })
    const lines = normalise(event({ type: 'wheel', deltaX: 2, deltaY: 3, deltaMode: 1 }), WINDOWS, HOST)
    expect(lines).toMatchObject({ dxPx: 32, dyPx: 48 })
    const pages = normalise(event({ type: 'wheel', deltaY: 1, deltaMode: 2 }), WINDOWS, HOST)
    expect(pages).toMatchObject({ dxPx: 0, dyPx: 300 })
  })

  it('a page of deltaX is the host width', () => {
    const pages = normalise(event({ type: 'wheel', deltaX: 0.25, deltaMode: 2 }), WINDOWS, HOST)
    expect(pages).toMatchObject({ dxPx: 100, dyPx: 0 })
  })

  it('a Mac Ctrl+click becomes a consumed secondary press; Cmd is meta, and Ctrl+Cmd or Ctrl elsewhere stays primary', () => {
    const press = normalise(event({ type: 'pointerdown', button: 0, ctrlKey: true }), MAC, HOST)
    expect(press).toMatchObject({ kind: 'down', role: 'secondary', ctrlConsumed: true, mods: { ctrl: true } })
    const withCommand = normalise(event({ type: 'pointerdown', button: 0, ctrlKey: true, metaKey: true }), MAC, HOST)
    expect(withCommand).toMatchObject({ role: 'primary', ctrlConsumed: false, mods: { ctrl: true, meta: true } })
    const elsewhere = normalise(event({ type: 'pointerdown', button: 0, ctrlKey: true }), WINDOWS, HOST)
    expect(elsewhere).toMatchObject({ role: 'primary', ctrlConsumed: false })
    const command = normalise(event({ type: 'pointerdown', button: 0, metaKey: true }), MAC, HOST)
    expect(command).toMatchObject({ role: 'primary', mods: { ctrl: false, meta: true } })
  })

  it('maps mouse buttons to roles and drops back and forward', () => {
    const role = (button: number) => normalise(event({ type: 'pointerdown', button }), WINDOWS, HOST)
    expect(role(0)).toMatchObject({ role: 'primary' })
    expect(role(1)).toMatchObject({ role: 'auxiliary' })
    expect(role(2)).toMatchObject({ role: 'secondary' })
    expect(role(3)).toBeNull()
    expect(role(4)).toBeNull()
  })

  it('never drops an up: a button it would not press with is a primary release for every pointer kind', () => {
    const up = (pointerType: string, button: number) =>
      normalise(event({ type: 'pointerup', pointerType, button, pointerId: 4 }), WINDOWS, HOST)
    // A pen's eraser and a mouse's back button end their session; a barrel release is secondary.
    expect(up('pen', 5)).toMatchObject({ kind: 'up', id: 4, pointer: 'pen', role: 'primary' })
    expect(up('mouse', 3)).toMatchObject({ kind: 'up', pointer: 'mouse', role: 'primary' })
    expect(up('pen', 2)).toMatchObject({ kind: 'up', pointer: 'pen', role: 'secondary' })
  })

  it('maps the pen tip to primary and the barrel to secondary, and drops the eraser', () => {
    const pen = (button: number) => normalise(event({ type: 'pointerdown', pointerType: 'pen', button }), WINDOWS, HOST)
    expect(pen(0)).toMatchObject({ pointer: 'pen', role: 'primary' })
    expect(pen(2)).toMatchObject({ pointer: 'pen', role: 'secondary' })
    expect(pen(5)).toBeNull()
  })

  it('makes every touch primary', () => {
    expect(normalise(event({ type: 'pointerdown', pointerType: 'touch', button: 0 }), WINDOWS, HOST))
      .toMatchObject({ pointer: 'touch', role: 'primary' })
  })

  it('keeps the pointer id, detail and host-relative point of a press', () => {
    expect(normalise(event({ type: 'pointerdown', pointerId: 9, detail: 2 }), WINDOWS, HOST)).toEqual({
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
      normalise(event(overrides), WINDOWS, HOST)
    expect(raw({ type: 'pointerup', pointerId: 2, button: 0 })).toMatchObject({ kind: 'up', id: 2, role: 'primary', target: SURFACE })
    expect(raw({ type: 'pointercancel', pointerId: 2 })).toEqual({ kind: 'cancel', t: 10, id: 2, reason: 'pointercancel' })
    expect(raw({ type: 'lostpointercapture', pointerId: 2 })).toEqual({ kind: 'cancel', t: 10, id: 2, reason: 'lost-capture' })
    expect(raw({ type: 'pointerleave' })).toEqual({ kind: 'leave', t: 10 })
    expect(raw({ type: 'gesturechange', rotation: 12 })).toEqual({ kind: 'platform-gesture', t: 10, phase: 'change', at: { x: 12, y: 34 }, rotationDeg: 12 })
    expect(raw({ type: 'gesturestart' })).toMatchObject({ phase: 'start', rotationDeg: 0 })
    expect(raw({ type: 'gestureend' })).toMatchObject({ phase: 'end' })
    expect(raw({ type: 'dragover' })).toMatchObject({ kind: 'drop', phase: 'over', payload: { kind: 'unknown' } })
    expect(raw({ type: 'dragleave' })).toMatchObject({ kind: 'drop', phase: 'leave' })
    expect(raw({ type: 'drop', dropPayload: { kind: 'species', species: null } }))
      .toMatchObject({ kind: 'drop', phase: 'drop', payload: { kind: 'species', species: null } })
  })
})
