import { describe, expect, it } from 'vitest'
import { CURRENT_BINDINGS } from './bindings'
import type { Gesture } from './gestures'
import {
  FOREIGN,
  MAC,
  MAC_GESTURES,
  OWNED_CHROME,
  OWNED_TEXT,
  ROTATE_HANDLE,
  SEQUENCES,
  SURFACE,
  WINDOWS,
  blur,
  configure,
  down,
  escape,
  gesture,
  keyState,
  lostCapture,
  move,
  reject,
  runSequence,
  seq,
  up,
  wheel,
  type Sequence,
} from './__fixtures__/sequences'

const run = (sequence: Sequence) => runSequence(sequence, CURRENT_BINDINGS)

/** Gesture kinds, pans with their phase. */
function kinds(gestures: readonly Gesture[]): string[] {
  return gestures.map((gesture) => (gesture.kind === 'pan' || gesture.kind === 'rotate') ? `${gesture.kind}:${gesture.phase}` : gesture.kind)
}

function withoutHovers(gestures: readonly Gesture[]): readonly Gesture[] {
  return gestures.filter((gesture) => gesture.kind !== 'hover')
}

function effectKinds(sequence: Sequence): string[] {
  return run(sequence).effects.map((effect) => effect.kind)
}

const NAVIGATION = new Set(['pan', 'zoom', 'rotate'])

function expectNoNavigation(gestures: readonly Gesture[]): void {
  expect(gestures.filter((gesture) => NAVIGATION.has(gesture.kind))).toEqual([])
}

function pansOf(gestures: readonly Gesture[]) {
  return gestures.flatMap((gesture) => gesture.kind === 'pan' ? [gesture] : [])
}

function zoomsOf(gestures: readonly Gesture[]) {
  return gestures.flatMap((gesture) => gesture.kind === 'zoom' ? [gesture] : [])
}

describe('recognise: 5.1 secondary button', () => {
  it('A1 Windows right-click: the button is inert and the contextmenu opens the menu', () => {
    const result = run(SEQUENCES.A1)
    expect(result.gestures).toEqual([{ kind: 'menu-request', at: { x: 101, y: 100 }, source: 'native' }])
    expect(effectKinds(SEQUENCES.A1)).toEqual(['prevent-default'])
    expect(result.steps[2]!.effects).toEqual([{ kind: 'prevent-default' }])
  })

  it('A2 Windows right-drag: no pan; the menu on the trailing contextmenu', () => {
    const result = run(SEQUENCES.A2)
    expectNoNavigation(result.gestures)
    expect(kinds(withoutHovers(result.gestures))).toEqual(['menu-request'])
    expect(effectKinds(SEQUENCES.A2)).toEqual(['prevent-default'])
  })

  it('A3 Linux right-click: the menu at the contextmenu', () => {
    const result = run(SEQUENCES.A3)
    expect(result.steps[1]!.gestures).toEqual([{ kind: 'menu-request', at: { x: 100, y: 100 }, source: 'native' }])
    expect(result.gestures).toHaveLength(1)
  })

  it.each([
    ['Linux', SEQUENCES.A4_LINUX],
    ['macOS', SEQUENCES.A4_MAC],
  ])('A4 %s right-drag: the menu at the press, no pan', (_os, sequence) => {
    const result = run(sequence)
    expectNoNavigation(result.gestures)
    expect(result.steps[1]!.gestures).toEqual([{ kind: 'menu-request', at: { x: 100, y: 100 }, source: 'native' }])
    expect(kinds(withoutHovers(result.gestures))).toEqual(['menu-request'])
  })

  it('A11 under LEGACY a right press during a left drag pans nothing and its contextmenu requests the menu', () => {
    const result = run(SEQUENCES.A11)
    expectNoNavigation(result.gestures)
    expect(kinds(result.gestures)).toEqual([
      'press', 'drag-start', 'drag-move', 'drag-move', 'menu-request', 'drag-move', 'drag-move', 'drag-move', 'drag-end',
    ])
    expect(result.gestures.at(-1)).toEqual({ kind: 'drag-end', id: 1, at: { x: 145, y: 122 }, mods: expect.any(Object) })
    expect(effectKinds(SEQUENCES.A11)).toEqual(['prevent-default', 'capture', 'prevent-default', 'release-capture'])
  })

  it('A12 Shift at the chord moment: no rotate, the band continues', () => {
    const result = run(SEQUENCES.A12)
    expectNoNavigation(result.gestures)
    expect(kinds(result.gestures)).toEqual(kinds(run(SEQUENCES.A11).gestures))
  })

  it('A13 Shift+right-drag with mod steps: nothing but hovers', () => {
    const result = run(SEQUENCES.A13)
    expect(withoutHovers(result.gestures)).toEqual([])
    expect(result.effects).toEqual([])
  })

  it('A15 Right-click in the note editor: the native menu stays, nothing is emitted', () => {
    const result = run(SEQUENCES.A15)
    expect(result.gestures).toEqual([])
    expect(result.effects).toEqual([])
  })

  it('A16 Right-click on a dock input: nothing is emitted, the contextmenu is not prevented', () => {
    const result = run(SEQUENCES.A16)
    expect(result.gestures).toEqual([])
    expect(result.effects).toEqual([])
  })

  it('A18 Shift after the press: no pan', () => {
    const result = run(SEQUENCES.A18)
    expect(withoutHovers(result.gestures)).toEqual([])
  })
})

describe('recognise: 5.2 macOS Ctrl+click', () => {
  it('B1 macOS Ctrl+click: an additive tap and the native menu', () => {
    const result = run(SEQUENCES.B1)
    expect(kinds(result.gestures)).toEqual(['press', 'menu-request', 'tap'])
    const press = result.gestures[0]
    expect(press).toMatchObject({ kind: 'press', mods: { ctrl: true, meta: false }, target: { kind: 'surface' } })
    expect(result.gestures[2]).toMatchObject({ kind: 'tap', mods: { ctrl: true } })
  })

  it('B2 macOS Ctrl+drag: an additive band and the menu', () => {
    const result = run(SEQUENCES.B2)
    expectNoNavigation(result.gestures)
    expect(kinds(result.gestures)).toEqual(['press', 'menu-request', 'drag-start', 'drag-move', 'drag-move', 'drag-end'])
    expect(result.gestures[2]).toMatchObject({ kind: 'drag-start', mods: { ctrl: true } })
  })

  it.each([
    ['Windows', SEQUENCES.B3_WINDOWS],
    ['Linux', SEQUENCES.B3_LINUX],
  ])('B3 Ctrl+click on %s: a tap with ctrl, no menu', (_os, sequence) => {
    const result = run(sequence)
    expect(kinds(result.gestures)).toEqual(['press', 'tap'])
    expect(result.gestures[1]).toMatchObject({ kind: 'tap', mods: { ctrl: true } })
  })

  it('B4 macOS two-finger trackpad click: as A3', () => {
    expect(run(SEQUENCES.B4).gestures).toEqual(run(SEQUENCES.A3).gestures)
  })

  it('B6 Mac Ctrl+Shift+click drag: a band, never a rotate', () => {
    const result = run(SEQUENCES.B6)
    expect(kinds(result.gestures)).toEqual(['press', 'drag-start', 'drag-move', 'drag-move', 'drag-move'])
  })
})

describe('recognise: 5.3 keyboard menu', () => {
  it.each([
    ['C1 Menu key on Windows', SEQUENCES.C1],
    ['C2 Shift+F10, contextmenu before keyup', SEQUENCES.C2_BEFORE_KEYUP],
    ['C2 Shift+F10, contextmenu after keyup', SEQUENCES.C2_AFTER_KEYUP],
    ['C3 Menu key held', SEQUENCES.C3],
  ])('%s: the echo is prevented and requests nothing (the keydown opened the menu)', (_name, sequence) => {
    const result = run(sequence)
    expect(result.gestures).toEqual([])
    expect(result.effects).toEqual([{ kind: 'prevent-default' }])
  })

  it('C4 Menu key in the text entry: the native text menu stays', () => {
    const result = run(SEQUENCES.C4)
    expect(result.gestures).toEqual([])
    expect(result.effects).toEqual([])
  })

  it('C5 Late echo: past the echo window the contextmenu opens a menu at its point (today)', () => {
    const result = run(SEQUENCES.C5)
    expect(result.gestures).toEqual([{ kind: 'menu-request', at: { x: 200, y: 150 }, source: 'native' }])
  })
})

describe('recognise: 5.4 pen', () => {
  it('D1 Pen barrel tap: nothing from the barrel; the native menu', () => {
    const result = run(SEQUENCES.D1)
    // The barrel's press is dropped; its up is kept (an up is never dropped) and ends no session.
    expect(result.steps[0]!.input).toBeNull()
    expect(result.steps[1]!.input).toMatchObject({ kind: 'up', pointer: 'pen', role: 'primary' })
    expect(kinds(result.gestures)).toEqual(['menu-request'])
  })

  it('D2 Pen barrel drag: nothing but hovers', () => {
    const result = run(SEQUENCES.D2)
    expect(withoutHovers(result.gestures)).toEqual([])
    expect(result.effects).toEqual([])
  })

  it('D3 Pen tip draw: a primary drag', () => {
    const result = run(SEQUENCES.D3)
    expect(kinds(result.gestures)).toEqual(['press', 'drag-start', 'drag-move', 'drag-move', 'drag-move', 'drag-end'])
    expect(result.gestures[0]).toMatchObject({ kind: 'press', pointer: 'pen' })
  })

  it('D4 Eraser: nothing', () => {
    const result = run(SEQUENCES.D4)
    expect(result.steps.map((step) => step.input?.kind ?? null)).toEqual([null, 'up'])
    expect(result.gestures).toEqual([])
  })

  it('D5 Pen hover: hovers only', () => {
    const result = run(SEQUENCES.D5)
    expect(kinds(result.gestures)).toEqual(['hover', 'hover', 'hover'])
    expect(result.gestures[0]).toMatchObject({ kind: 'hover', pointer: 'pen' })
  })

  it('D6 Wacom as mouse: a mouse drag', () => {
    const result = run(SEQUENCES.D6)
    expect(kinds(result.gestures)).toEqual(['press', 'drag-start', 'drag-move', 'drag-move', 'drag-move', 'drag-end'])
    expect(result.gestures[0]).toMatchObject({ kind: 'press', pointer: 'mouse' })
  })

  it('D7 Pen barrel + Shift drag: nothing from the barrel', () => {
    expect(withoutHovers(run(SEQUENCES.D7).gestures)).toEqual([])
  })
})

describe('recognise: 5.5 touch and trackpad gestures', () => {
  it('E1 One-finger tap: a tap, no hover left behind', () => {
    const result = run(SEQUENCES.E1)
    expect(kinds(result.gestures)).toEqual(['press', 'tap'])
    expect(result.gestures[0]).toMatchObject({ pointer: 'touch' })
  })

  it('E2 One-finger drag: a primary drag, never a pan', () => {
    expect(kinds(run(SEQUENCES.E2).gestures)).toEqual(['press', 'drag-start', 'drag-move', 'drag-move', 'drag-end'])
  })

  it('E3 Browser steals the touch: cancelled, no half band committed', () => {
    const result = run(SEQUENCES.E3)
    expect(kinds(result.gestures)).toEqual(['press', 'drag-start', 'drag-move', 'cancel'])
    expect(result.gestures.at(-1)).toEqual({ kind: 'cancel', reason: 'pointercancel' })
  })

  it('E4 Two fingers: the second touch is ignored and the first draws', () => {
    const result = run(SEQUENCES.E4)
    expectNoNavigation(result.gestures)
    expect(kinds(result.gestures)).toEqual(['press', 'drag-start', 'drag-move', 'drag-end'])
    expect(result.gestures.every((gesture) => !('id' in gesture) || gesture.id === 1)).toBe(true)
  })

  it('E5 Second finger after a drag started: ignored; the drag continues', () => {
    const result = run(SEQUENCES.E5)
    expect(kinds(result.gestures)).toEqual(['press', 'drag-start', 'drag-move', 'drag-move', 'drag-move', 'drag-end'])
  })

  it('E6 Long press on Android: the native contextmenu opens the menu, the touch still ends in a tap', () => {
    expect(kinds(run(SEQUENCES.E6).gestures)).toEqual(['press', 'menu-request', 'tap'])
  })

  it('E7 Long press on iOS: no timer, a tap', () => {
    expect(kinds(run(SEQUENCES.E7).gestures)).toEqual(['press', 'tap'])
  })

  it('E8 Long press with movement: a drag, no menu', () => {
    expect(kinds(run(SEQUENCES.E8).gestures)).toEqual(['press', 'drag-start', 'drag-end'])
  })

  it('E9 a pinch with 4 degrees of drift never rotates', () => {
    const result = run(SEQUENCES.E9)
    expect(result.gestures).toEqual([])
    // The page never zooms itself: WebKit's own pinch arrives as Ctrl wheels (F12).
    expect(result.steps.map((step) => step.effects)).toEqual(Array(4).fill([{ kind: 'prevent-default' }]))
  })

  it('E10 a 20 degree twist rotates from 0 after 10', () => {
    const result = run(SEQUENCES.E10)
    const twist = (phase: 'start' | 'move' | 'end', totalDeltaDeg: number) =>
      ({ kind: 'rotate', phase, anchorPx: { x: 200, y: 150 }, totalDeltaDeg, step: false, source: 'trackpad-twist' })
    // WebKit's rotation is clockwise-positive and the ground follows the fingers: a clockwise twist lowers the bearing.
    expect(result.steps.map((step) => step.gestures)).toEqual([
      [],
      [],
      [twist('start', 0), twist('move', -2)],
      [twist('move', -10)],
      [twist('end', -10)],
    ])
    expect(result.steps.map((step) => step.effects)).toEqual(Array(5).fill([{ kind: 'prevent-default' }]))
    expect(result.state.sessions.size).toBe(0)
  })

  it('a twist the other way subtracts the threshold the other way', () => {
    const result = run(seq('anticlockwise twist', MAC_GESTURES, [
      gesture('start', 0),
      gesture('change', -15),
      gesture('change', -4),
      gesture('end', -4),
    ]))
    expect(result.gestures.map((gesture) => gesture.kind === 'rotate' && [gesture.phase, gesture.totalDeltaDeg])).toEqual([
      ['start', 0], ['move', 5], ['move', -6], ['end', -6],
    ])
  })

  it.each([
    ['Esc', escape(), 'escape'],
    ['blur', blur(), 'blur'],
    ['configure', configure({ tool: 'polygon', mode: 'site', pointingDevice: 'trackpad' }), 'tool-change'],
  ] as const)('%s cancels a live twist, and the rest of the twist turns nothing', (_fence, fence, reason) => {
    const result = run(seq('fenced twist', MAC_GESTURES, [
      gesture('start', 0),
      gesture('change', 20),
      fence,
      gesture('change', 30),
      gesture('end', 30),
    ]))
    expect(kinds(result.gestures)).toEqual(['rotate:start', 'rotate:move', 'rotate:cancel', 'cancel'])
    expect(result.gestures.at(-1)).toEqual({ kind: 'cancel', reason })
    expect(result.steps[3]!.effects).toEqual([{ kind: 'prevent-default' }])
    expect(result.state.sessions.size).toBe(0)
  })

  it('a twist is ignored during a pointer pan or rotate, and a press during a twist is ignored', () => {
    const duringPan = run(seq('twist during a pan', MAC_GESTURES, [
      down(100, 100, { button: 1 }),
      gesture('start', 0),
      gesture('change', 20),
      move(120, 100, { buttons: 4 }),
      gesture('end', 20),
      up(120, 100, { button: 1 }),
    ]))
    expect(kinds(duringPan.gestures)).toEqual(['pan:start', 'pan:move', 'pan:end'])
    const duringRotate = run(seq('twist during a rotate', MAC_GESTURES, [
      down(100, 100, { button: 1, shift: true }),
      move(120, 100, { buttons: 4, shift: true }),
      gesture('start', 0),
      gesture('change', 20),
      gesture('end', 20),
      up(120, 100, { button: 1, shift: true }),
    ]))
    expect(duringRotate.gestures.every((gesture) => gesture.kind === 'rotate' && gesture.source === 'auxiliary-drag')).toBe(true)
    expect(kinds(duringRotate.gestures)).toEqual(['rotate:start', 'rotate:move', 'rotate:end'])
    const pressDuringTwist = run(seq('press during a twist', MAC_GESTURES, [
      gesture('start', 0),
      gesture('change', 20),
      down(100, 100),
      move(140, 100, { buttons: 1 }),
      up(140, 100),
      gesture('end', 20),
    ]))
    expect(kinds(pressDuringTwist.gestures)).toEqual(['rotate:start', 'rotate:move', 'rotate:end'])
    expect(pressDuringTwist.steps[2]!.effects).toEqual([])
  })

  it('E11 Touch behaves like today: a primary drag; the second touch is ignored; no long press', () => {
    const result = run(SEQUENCES.E11)
    expect(kinds(result.gestures)).toEqual(['press', 'drag-start', 'drag-move', 'drag-end'])
  })

  it('E12 iOS gesture events alongside pointers: one source of truth, the first pointer; gesture events prevented', () => {
    const result = run(SEQUENCES.E12)
    expect(kinds(result.gestures)).toEqual(['press', 'drag-start', 'drag-end'])
    for (const index of [2, 3, 6]) expect(result.steps[index]!.effects).toEqual([{ kind: 'prevent-default' }])
  })

  it.each([
    ['Plant stamp', SEQUENCES.E13_PLANT_STAMP],
    ['Polygon', SEQUENCES.E13_POLYGON],
  ])('E13 Press-acting tools under a pinch (%s): the first finger presses (today), the second is ignored', (_tool, sequence) => {
    const result = run(sequence)
    expectNoNavigation(result.gestures)
    expect(kinds(result.gestures)).toEqual(['press', 'drag-start'])
  })

  it('E14 Press-acting tools under a long press: no menu, a press and a tap', () => {
    expect(kinds(run(SEQUENCES.E14).gestures)).toEqual(['press', 'tap'])
  })
})

describe('recognise: 5.6 wheel and trackpad', () => {
  it('F1 Windows wheel notch, Mouse: zoom about the pointer', () => {
    const result = run(SEQUENCES.F1)
    expect(result.gestures).toEqual([{ kind: 'zoom', anchorPx: { x: 120, y: 80 }, factor: Math.exp(-0.2), source: 'wheel' }])
    expect(result.effects).toEqual([{ kind: 'prevent-default' }])
  })

  it('F2 Same, Trackpad: pan', () => {
    expect(pansOf(run(SEQUENCES.F2).gestures)).toEqual([{ kind: 'pan', phase: 'move', deltaPx: { x: 0, y: -100 }, source: 'wheel' }])
  })

  it('F3 Firefox line mode: lines become 16 px before anything else', () => {
    const [zoom] = zoomsOf(run(SEQUENCES.F3).gestures)
    expect(zoom?.factor).toBeCloseTo(Math.exp(-48 * 0.002), 12)
  })

  it.each([
    ['Mouse', SEQUENCES.F4_MOUSE],
    ['Trackpad', SEQUENCES.F4_TRACKPAD],
  ])('F4 Chromium pinch (synthetic Ctrl), %s: zoom in, default prevented', (_device, sequence) => {
    const result = run(sequence)
    const zooms = zoomsOf(result.gestures)
    expect(zooms).toHaveLength(1)
    expect(zooms[0]!.factor).toBeGreaterThan(1)
    expect(zooms[0]!.source).toBe('wheel')
    expect(result.effects).toEqual([{ kind: 'prevent-default' }])
  })

  it('F5 Real Ctrl + wheel: zoom on the same path, clamped', () => {
    const zooms = zoomsOf(run(SEQUENCES.F5).gestures)
    expect(zooms).toEqual([{ kind: 'zoom', anchorPx: { x: 120, y: 80 }, factor: Math.exp(-0.2), source: 'wheel' }])
  })

  it('F6 Trackpad scroll, Trackpad: pan both axes', () => {
    expect(pansOf(run(SEQUENCES.F6).gestures)).toEqual([{ kind: 'pan', phase: 'move', deltaPx: { x: -3.5, y: 7.25 }, source: 'wheel' }])
  })

  it('F7 Trackpad scroll, Mouse: zoom on dy, dx ignored', () => {
    const result = run(SEQUENCES.F7)
    expect(pansOf(result.gestures)).toEqual([])
    expect(zoomsOf(result.gestures)[0]?.factor).toBeCloseTo(Math.exp(7.25 * 0.002), 12)
  })

  it.each([
    ['F8 Shift + wheel, Trackpad, one axis', SEQUENCES.F8, { x: -100, y: 0 }],
    ['F9 Shift + wheel, macOS swapped', SEQUENCES.F9, { x: -100, y: 0 }],
    ['F10 Shift + wheel, Mouse', SEQUENCES.F10, { x: 0, y: -100 }],
    ['F10b Shift + wheel delivered as dx', SEQUENCES.F10B, { x: -100, y: 0 }],
  ])('%s: pans by today\'s rule', (_name, sequence, deltaPx) => {
    expect(pansOf(run(sequence).gestures)).toEqual([{ kind: 'pan', phase: 'move', deltaPx, source: 'wheel' }])
  })

  it('F11 WKWebView pinch and rotate: no zoom from the scale; the rotate starts only past 10 degrees', () => {
    const result = run(SEQUENCES.F11)
    expect(zoomsOf(result.gestures)).toEqual([])
    expect(result.steps[1]!.gestures).toEqual([])
    expect(result.gestures.map((gesture) => gesture.kind === 'rotate' && [gesture.phase, gesture.totalDeltaDeg])).toEqual([
      ['start', 0], ['move', -2], ['end', -2],
    ])
  })

  it('F12 WKWebView pinch with Ctrl wheels: the gesture\'s scale is ignored and each Ctrl wheel zooms', () => {
    const zooms = zoomsOf(run(SEQUENCES.F12).gestures)
    expect(zooms).toHaveLength(2)
    expect(zooms.every((zoom) => zoom.factor > 1 && zoom.source === 'wheel')).toBe(true)
  })

  it('a Ctrl+wheel zooms continuously by its delta, a pinch\'s synthetic Ctrl and a held Control alike', () => {
    const pinch = zoomsOf(run(SEQUENCES.F4_MOUSE).gestures)
    const held = zoomsOf(run(seq('Ctrl+wheel with Control held', MAC, [
      keyState(false, { ctrl: true }),
      wheel(120, 80, { dy: -2.3, ctrl: true }),
      keyState(false),
    ])).gestures)
    const zoom = { kind: 'zoom', anchorPx: { x: 120, y: 80 }, factor: Math.exp(2.3 * 0.002), source: 'wheel' }
    expect(pinch).toEqual([zoom])
    expect(held).toEqual([zoom])
  })

  it('F14 Momentum tail: wheels stay standalone and the press starts a fresh session', () => {
    const result = run(SEQUENCES.F14)
    expect(kinds(result.gestures)).toEqual([
      ...Array(10).fill('zoom'), 'press', ...Array(10).fill('zoom'), 'tap',
    ])
  })

  it('F15 Wheel over owned text: not prevented, no output', () => {
    const result = run(SEQUENCES.F15)
    expect(result.gestures).toEqual([])
    expect(result.effects).toEqual([])
  })

  it('F16 Page mode: a page of dy is the host height and a page of dx the host width', () => {
    expect(pansOf(run(SEQUENCES.F16).gestures).map((pan) => pan.deltaPx)).toEqual([{ x: 0, y: -300 }, { x: -100, y: 0 }])
  })

  it('F17 Alt + wheel: zoom as without Alt, never a rotate', () => {
    expect(run(SEQUENCES.F17).gestures).toEqual(run(SEQUENCES.F1).gestures.map((gesture) => ({ ...gesture })))
  })

  it('F18 a wheel during a pointer rotate is ignored', () => {
    const result = run(SEQUENCES.F18)
    expect(kinds(result.gestures)).toEqual([
      'rotate:start', 'rotate:move', 'rotate:move', 'rotate:move', 'rotate:move', 'rotate:end',
    ])
    expect(zoomsOf(result.gestures)).toEqual([])
    // The wheel stays the map's: the page neither scrolls nor zooms.
    expect(result.steps[3]!.effects).toEqual([{ kind: 'prevent-default' }])
  })
})

describe('recognise: 5.7 middle button and Space', () => {
  it('G1 Middle-drag: pan, pointerdown default-prevented', () => {
    const result = run(SEQUENCES.G1)
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:move', 'pan:end'])
    expect(pansOf(result.gestures).map((pan) => pan.source)).toEqual(Array(5).fill('auxiliary-drag'))
    expect(result.steps[0]!.effects).toEqual([{ kind: 'prevent-default' }, { kind: 'capture', pointerId: 1 }])
  })

  it('G2 Middle-click on Linux: nothing moves; pointerdown prevented', () => {
    const result = run(SEQUENCES.G2)
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:end'])
    expect(pansOf(result.gestures).every((pan) => pan.deltaPx.x === 0 && pan.deltaPx.y === 0)).toBe(true)
    expect(result.steps[0]!.effects[0]).toEqual({ kind: 'prevent-default' })
  })

  it('G3 Space+drag: Space recorded once, a space-drag pan, not a band', () => {
    const result = run(SEQUENCES.G3)
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:move', 'pan:move', 'pan:end'])
    expect(pansOf(result.gestures)[0]!.source).toBe('space-drag')
    const moved = pansOf(result.gestures).reduce((sum, pan) => ({ x: sum.x + pan.deltaPx.x, y: sum.y + pan.deltaPx.y }), { x: 0, y: 0 })
    expect(moved).toEqual({ x: 40, y: -10 })
  })

  it('G3b Space at a press on a handle: the handle drags (today\'s handle-first order)', () => {
    const result = run(SEQUENCES.G3B)
    expect(kinds(result.gestures)).toEqual(['press', 'drag-start', 'drag-move', 'drag-move', 'drag-end'])
    expect(result.gestures[0]).toMatchObject({ kind: 'press', target: { kind: 'handle', id: 'rotate' } })
    expect(result.gestures[1]).toMatchObject({ kind: 'drag-start', target: { kind: 'handle', id: 'rotate' } })
  })

  it('G4 Space then alt-tab: blur releases Space; the later drag is primary', () => {
    expect(kinds(run(SEQUENCES.G4).gestures)).toEqual(['press', 'drag-start', 'drag-move', 'drag-move', 'drag-end'])
  })

  it('G5 Stale Space: with no visibilitychange listener only blur clears Space (today)', () => {
    expect(pansOf(run(SEQUENCES.G5).gestures)[0]).toMatchObject({ phase: 'start', source: 'space-drag' })
  })

  it('G6 X11 autorepeat pairs: the pan continues', () => {
    expect(kinds(run(SEQUENCES.G6).gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:end'])
  })

  it('G9 Shift+middle-drag rotates: nothing until 3 px, then +16° at 20 px, measured from the press', () => {
    const result = run(SEQUENCES.G9)
    expect(result.steps[0]!.gestures).toEqual([])
    expect(result.steps[0]!.effects).toEqual([{ kind: 'prevent-default' }, { kind: 'capture', pointerId: 1 }])
    expect(result.steps[1]!.gestures).toEqual([])
    expect(result.gestures).toEqual([
      { kind: 'rotate', phase: 'start', anchorPx: { x: 100, y: 100 }, totalDeltaDeg: 0, step: false, source: 'auxiliary-drag' },
      { kind: 'rotate', phase: 'move', anchorPx: { x: 100, y: 100 }, totalDeltaDeg: 16, step: false, source: 'auxiliary-drag' },
      { kind: 'rotate', phase: 'end', anchorPx: { x: 100, y: 100 }, totalDeltaDeg: 16, step: false, source: 'auxiliary-drag' },
    ])
    expect(result.steps.at(-1)!.effects).toEqual([{ kind: 'release-capture', pointerId: 1 }])
  })

  it('G9b a still Shift+middle click turns nothing', () => {
    const result = run(SEQUENCES.G9B)
    expect(result.gestures).toEqual([])
    expect(result.effects).toEqual([
      { kind: 'prevent-default' },
      { kind: 'capture', pointerId: 1 },
      { kind: 'release-capture', pointerId: 1 },
    ])
  })

  it('G9c Shift+middle-drag in overview rotates', () => {
    const result = run(SEQUENCES.G9C)
    expect(kinds(result.gestures)).toEqual(['rotate:start', 'rotate:move', 'rotate:end'])
    expect(result.gestures).toEqual(run(SEQUENCES.G9).gestures)
  })

  it('a modifier change during a rotate re-emits the move with the new step', () => {
    const steps = (platform: typeof WINDOWS) => run(seq('rotate step', platform, [
      down(100, 100, { button: 1, shift: true }),
      move(120, 100, { buttons: 4, shift: true }),
      keyState(false, { shift: true, ctrl: true }),
      keyState(false, { shift: true, meta: true }),
      keyState(false, { shift: true }),
      move(125, 100, { buttons: 4, shift: true, ctrl: true }),
    ])).steps
    const rotate = (totalDeltaDeg: number, step: boolean) =>
      ({ kind: 'rotate', phase: 'move', anchorPx: { x: 100, y: 100 }, totalDeltaDeg, step, source: 'auxiliary-drag' })
    // mod is Ctrl off a Mac: each key change re-emits the last total with the step it now reads.
    const windows = steps(WINDOWS)
    expect(windows.slice(2).map((step) => step.gestures)).toEqual([
      [rotate(16, true)], [rotate(16, false)], [rotate(16, false)], [rotate(20, true)],
    ])
    // On a Mac mod is Cmd: Ctrl never steps.
    const mac = steps(MAC_GESTURES)
    expect(mac.slice(2).map((step) => step.gestures)).toEqual([
      [rotate(16, false)], [rotate(16, true)], [rotate(16, false)], [rotate(20, false)],
    ])
  })

  it('Esc during a Shift+middle rotate cancels the rotate, then the session', () => {
    const result = run(seq('escape rotate', WINDOWS, [
      down(100, 100, { button: 1, shift: true }),
      move(120, 100, { buttons: 4, shift: true }),
      escape(),
    ]))
    expect(kinds(result.gestures)).toEqual(['rotate:start', 'rotate:move', 'rotate:cancel', 'cancel'])
    expect(result.gestures.at(-1)).toEqual({ kind: 'cancel', reason: 'escape' })
    expect(result.state.sessions.size).toBe(0)
  })

  it('G10 Space while a rail button has focus: no pan arming, a primary drag', () => {
    expect(kinds(run(SEQUENCES.G10).gestures)).toEqual(['press', 'drag-start', 'drag-move', 'drag-move', 'drag-end'])
  })
})

describe('recognise: 5.9 precedence', () => {
  it('J1 Left-drag never pans: Select bands, the Pan tool pans', () => {
    const select = run(SEQUENCES.J1_SELECT)
    expectNoNavigation(select.gestures)
    expect(kinds(select.gestures)).toEqual(['press', 'drag-start', 'drag-move', 'drag-move', 'drag-end'])
    const hand = run(SEQUENCES.J1_HAND)
    // The Pan tool's press reaches the host; after its drag panned, the press ends with cancel('navigate').
    expect(kinds(hand.gestures)).toEqual(['press', 'pan:start', 'pan:move', 'pan:move', 'pan:move', 'pan:end', 'cancel'])
    expect(pansOf(hand.gestures)[0]!.source).toBe('primary-drag')
    expect(hand.gestures.at(-1)).toEqual({ kind: 'cancel', reason: 'navigate' })
  })

  it('J2 Shift+drag is not box zoom: an additive band', () => {
    const result = run(SEQUENCES.J2)
    expectNoNavigation(result.gestures)
    expect(result.gestures[0]).toMatchObject({ kind: 'press', mods: { shift: true } })
  })

  it('J3 Legacy overview: a drag pans; a still right-click is prevented and opens no menu', () => {
    const dragged = run(SEQUENCES.J3_DRAG)
    expect(kinds(dragged.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:move', 'pan:end'])
    expect(pansOf(dragged.gestures)[0]!.source).toBe('primary-drag')
    const clicked = run(SEQUENCES.J3_RIGHT_CLICK)
    expect(clicked.gestures).toEqual([])
    expect(clicked.steps[2]!.effects).toEqual([{ kind: 'prevent-default' }])
  })

  it('J9 Space with the Pan tool: a space-drag pan', () => {
    const result = run(SEQUENCES.J9)
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:move', 'pan:end'])
    expect(pansOf(result.gestures)[0]!.source).toBe('space-drag')
  })

  it('J10 Space held and overview presses pan and never reach the probe', () => {
    for (const sequence of [SEQUENCES.J10_SPACE, SEQUENCES.J10_OVERVIEW]) {
      const result = run(sequence)
      expect(result.gestures.some((gesture) => gesture.kind === 'press' || gesture.kind === 'tap')).toBe(false)
      expect(kinds(result.gestures)[0]).toBe('pan:start')
      expect(kinds(result.gestures).at(-1)).toBe('pan:end')
    }
  })
})

describe('recognise: sessions', () => {
  it('a second down on a live pointer id ends its session', () => {
    const result = run(seq('lost pointerup', WINDOWS, [
      down(100, 100),
      move(120, 100, { buttons: 1 }),
      down(200, 200),
      up(200, 200),
    ]))
    expect(kinds(result.gestures)).toEqual(['press', 'drag-start', 'cancel', 'press', 'tap'])
    expect(result.steps[2]!.effects).toEqual([
      { kind: 'release-capture', pointerId: 1 },
      { kind: 'prevent-default' },
      { kind: 'capture', pointerId: 1 },
    ])
  })

  it('a move with buttons and no session is a hover', () => {
    const result = run(seq('stray buttons', WINDOWS, [move(50, 60, { buttons: 1 }), move(55, 60, { buttons: 2 })]))
    expect(result.gestures).toEqual([
      { kind: 'hover', at: { x: 50, y: 60 }, pointer: 'mouse', mods: { shift: false, ctrl: false, alt: false, meta: false }, target: { kind: 'surface' } },
      { kind: 'hover', at: { x: 55, y: 60 }, pointer: 'mouse', mods: { shift: false, ctrl: false, alt: false, meta: false }, target: { kind: 'surface' } },
    ])
  })

  it('a hover carries the target class it saw', () => {
    const result = run(seq('hover targets', WINDOWS, [
      move(50, 60),
      move(56, 60, { target: FOREIGN }),
    ]))
    expect(result.gestures.map((gesture) => gesture.kind === 'hover' ? gesture.target : null)).toEqual([SURFACE, FOREIGN])
  })

  it('owned chrome always ends the hover', () => {
    // Owned chrome (a map button, the attribution), the text entry and a handle end the hover and its tooltip (U6).
    const result = run(seq('owned targets', WINDOWS, [
      move(50, 60),
      move(52, 60, { target: OWNED_CHROME }),
      move(54, 60, { target: OWNED_TEXT }),
      move(56, 60, { target: ROTATE_HANDLE }),
      move(58, 60, { target: FOREIGN }),
    ]))
    expect(result.steps.map((step) => kinds(step.gestures))).toEqual([
      ['hover'], ['hover-end'], ['hover-end'], ['hover-end'], ['hover'],
    ])
  })

  it('a 2 px mouse or pen jitter is a tap; 3 px starts a drag', () => {
    for (const pointer of ['mouse', 'pen'] as const) {
      const jitter = run(seq(`${pointer} jitter`, WINDOWS, [
        down(100, 100, { pointer }),
        move(102, 100, { pointer, buttons: 1 }),
        move(100, 102, { pointer, buttons: 1 }),
        up(101, 101, { pointer }),
      ]))
      expect(kinds(jitter.gestures)).toEqual(['press', 'tap'])
      const dragged = run(seq(`${pointer} drag`, WINDOWS, [
        down(100, 100, { pointer }),
        move(102, 100, { pointer, buttons: 1 }),
        move(103, 100, { pointer, buttons: 1 }),
        up(103, 100, { pointer }),
      ]))
      expect(kinds(dragged.gestures)).toEqual(['press', 'drag-start', 'drag-end'])
      // The drag starts where the press was, at the move that passed the threshold.
      expect(dragged.gestures[1]).toMatchObject({ from: { x: 100, y: 100 }, at: { x: 103, y: 100 } })
    }
  })

  it('Plant a row keeps slop 0 through configure', () => {
    const result = run(seq('plant a row', WINDOWS, [
      { raw: { kind: 'configure', context: { tool: 'plant-spacing', mode: 'site', pointingDevice: 'mouse', dragSlopPx: 0 } } },
      down(100, 100),
      move(101, 100, { buttons: 1 }),
      up(101, 100),
    ]))
    expect(kinds(result.gestures)).toEqual(['press', 'drag-start', 'drag-end'])
  })

  it('a pointer-source pan carries the pointer\'s point and a wheel pan does not', () => {
    const space = run(SEQUENCES.G3)
    const points = pansOf(space.gestures).map((pan) => pan.at)
    expect(points[0]).toEqual({ x: 100, y: 100 })
    expect(points.every((point) => point !== undefined)).toBe(true)
    expect(points.at(-1)).toEqual(points.at(-2))
    const fenced = run(seq('escape pan', WINDOWS, [down(100, 100, { button: 1 }), move(110, 100, { buttons: 4 }), escape()]))
    expect(pansOf(fenced.gestures).at(-1)).toMatchObject({ phase: 'end', at: { x: 110, y: 100 } })
    const wheeled = run(seq('wheel pan', WINDOWS, [wheel(100, 100, { dx: 10, dy: 20 })], { pointingDevice: 'trackpad' }))
    expect(pansOf(wheeled.gestures)).toHaveLength(1)
    expect(pansOf(wheeled.gestures)[0]).not.toHaveProperty('at')
  })

  it('pointerleave ends the hover', () => {
    const result = run(seq('leave', WINDOWS, [move(50, 60), { raw: { kind: 'leave' } }]))
    expect(kinds(result.gestures)).toEqual(['hover', 'hover-end'])
  })

  it('a reject ends the session with no gesture', () => {
    const result = run(seq('refused press', WINDOWS, [
      down(100, 100),
      reject(1),
      move(120, 100, { buttons: 1 }),
      up(120, 100),
    ]))
    expect(result.steps[1]!.gestures).toEqual([])
    expect(result.steps[1]!.effects).toEqual([{ kind: 'release-capture', pointerId: 1 }])
    expect(kinds(result.gestures)).toEqual(['press', 'hover'])
    expect(result.state.sessions.size).toBe(0)
  })

  it('in overview a pointerup with no session passes untouched', () => {
    const overview = run(seq('stray up in overview', WINDOWS, [up(100, 100, { target: FOREIGN })], { mode: 'overview' }))
    expect(overview.effects).toEqual([])
    expect(overview.gestures).toEqual([])
    const site = run(seq('stray up on site', WINDOWS, [up(100, 100, { target: FOREIGN })]))
    expect(site.effects).toEqual([])
  })

  it('presses on the canvas\'s own chrome, the note editor or outside the map start nothing', () => {
    const result = run(seq('owned presses', WINDOWS, [
      down(10, 10, { target: OWNED_CHROME }),
      up(10, 10),
      down(20, 20, { target: OWNED_TEXT, button: 1 }),
      up(20, 20, { button: 1 }),
      down(30, 30, { target: FOREIGN }),
      up(30, 30),
    ]))
    expect(result.gestures).toEqual([])
    expect(result.effects).toEqual([])
  })

  it('a Pan-tool click reaches the host as a press and a tap', () => {
    const result = run(seq('Pan tool click', WINDOWS, [down(100, 100, { detail: 2 }), up(100, 100)], { tool: 'hand' }))
    expect(kinds(result.gestures)).toEqual(['press', 'pan:start', 'pan:end', 'tap'])
    expect(result.gestures[3]).toMatchObject({ kind: 'tap', clickCount: 2 })
  })

  it('clickCount is the platform\'s detail as delivered', () => {
    const result = run(seq('jsdom click', WINDOWS, [down(100, 100, { detail: 0 }), up(100, 100)]))
    expect(result.gestures[0]).toMatchObject({ kind: 'press', clickCount: 0 })
    expect(result.gestures[1]).toMatchObject({ kind: 'tap', clickCount: 0 })
  })
})

describe('recognise: cancel fences', () => {
  it('Esc during a drag cancels it and releases Space', () => {
    const result = run(seq('escape', WINDOWS, [
      down(100, 100),
      move(120, 100, { buttons: 1 }),
      keyState(true),
      escape(),
      move(130, 100, { buttons: 1 }),
    ]))
    expect(kinds(result.gestures)).toEqual(['press', 'drag-start', 'cancel', 'hover'])
    expect(result.gestures[2]).toEqual({ kind: 'cancel', reason: 'escape' })
    expect(result.state.held.space).toBe(false)
  })

  it('Esc during a pan ends the pan where it is, then cancels', () => {
    const result = run(seq('escape pan', WINDOWS, [down(100, 100, { button: 1 }), move(110, 100, { buttons: 4 }), escape()]))
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:move', 'pan:end', 'cancel'])
  })

  it('arming a tool cancels the live session, the armed tool included; a pointing-device change does not', () => {
    // Today's setTool cancels the live gesture whatever the tool (scene-interaction.ts setTool → _cancelTransientInteraction):
    // V during a band drag with Select armed drops the band, and the pointer's later moves are hovers.
    const rearmed = run(seq('re-arm the armed tool', WINDOWS, [
      down(100, 100),
      move(120, 100, { buttons: 1 }),
      configure({ tool: 'select', mode: 'site', pointingDevice: 'mouse' }),
      move(130, 100, { buttons: 1 }),
      up(130, 100),
    ]))
    expect(kinds(rearmed.gestures)).toEqual(['press', 'drag-start', 'cancel', 'hover'])
    expect(rearmed.gestures[2]).toEqual({ kind: 'cancel', reason: 'tool-change' })
    expect(rearmed.state.sessions.size).toBe(0)
    const device = run(seq('pointing device', WINDOWS, [
      down(100, 100),
      configure({ tool: 'select', mode: 'site', pointingDevice: 'trackpad' }),
      up(100, 100),
    ]))
    expect(kinds(device.gestures)).toEqual(['press', 'tap'])
    const changed = run(seq('tool change', WINDOWS, [
      down(100, 100),
      configure({ tool: 'polygon', mode: 'site', pointingDevice: 'mouse' }),
      up(100, 100),
    ]))
    expect(kinds(changed.gestures)).toEqual(['press', 'cancel'])
    expect(changed.gestures[1]).toEqual({ kind: 'cancel', reason: 'tool-change' })
  })

  it('entering overview cancels the live session and releases Space; leaving it cancels nothing', () => {
    const result = run(seq('overview', WINDOWS, [
      keyState(true),
      down(100, 100, { button: 1 }),
      configure({ tool: 'select', mode: 'overview', pointingDevice: 'mouse' }),
    ]))
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:end', 'cancel'])
    expect(result.state.held.space).toBe(false)
    const leaving = run(seq('leave overview', WINDOWS, [
      down(100, 100),
      configure({ tool: 'select', mode: 'site', pointingDevice: 'mouse' }),
    ], { mode: 'overview' }))
    expect(kinds(leaving.gestures)).toEqual(['pan:start'])
  })

  it('a lost capture ends the session that holds capture', () => {
    const captured = run(seq('lost capture', WINDOWS, [down(100, 100), lostCapture({ id: 1 })]))
    expect(kinds(captured.gestures)).toEqual(['press', 'cancel'])
    expect(captured.steps[1]!.effects).toEqual([])
  })

  it('a pointercancel for another pointer changes nothing; blur cancels and releases Space', () => {
    const result = run(seq('pointercancel and blur', WINDOWS, [
      keyState(true),
      down(100, 100, { button: 1 }),
      { raw: { kind: 'cancel', id: 7, reason: 'pointercancel' } },
      blur(),
    ]))
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:end', 'cancel'])
    expect(result.gestures.at(-1)).toEqual({ kind: 'cancel', reason: 'blur' })
    expect(result.state.held.space).toBe(false)
  })
})

describe('recognise: drops', () => {
  it('forwards each drag phase and prevents dragover and drop', () => {
    const result = run(SEQUENCES.DROP)
    expect(result.gestures.map((gesture) => gesture.kind === 'drop' ? gesture.phase : gesture.kind)).toEqual(['over', 'over', 'leave', 'drop'])
    expect(result.steps.map((step) => step.effects.map((effect) => effect.kind))).toEqual([
      ['prevent-default'], ['prevent-default'], [], ['prevent-default'],
    ])
  })
})
