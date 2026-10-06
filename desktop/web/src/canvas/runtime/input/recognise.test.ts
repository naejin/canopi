import { describe, expect, it } from 'vitest'
import type { Gesture } from './gestures'
import {
  ANDROID,
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
  pointerCancel,
  reject,
  runSequence,
  seq,
  up,
  wheel,
  type Sequence,
} from './__fixtures__/sequences'

const run = (sequence: Sequence) => runSequence(sequence)

/** Gesture kinds, pans with their phase. */
function kinds(gestures: readonly Gesture[]): string[] {
  return gestures.map((gesture) => (gesture.kind === 'pan' || gesture.kind === 'rotate') ? `${gesture.kind}:${gesture.phase}` : gesture.kind)
}

const NAVIGATION = new Set(['pan', 'zoom', 'rotate'])
const NO_MODS = Object.freeze({ shift: false, ctrl: false, alt: false, meta: false })

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
  const menu = (x: number, y: number) => ({ kind: 'menu-request', at: { x, y }, source: 'mouse' })
  const TOOLS = [
    'select', 'hand', 'plant-stamp', 'text', 'line', 'measurement-guide', 'rectangle', 'ellipse', 'polygon', 'object-stamp',
    'saved-object-stamp', 'plant-spacing',
  ] as const

  it('A1 Windows right-click: one menu at the release point on up, nothing at the press', () => {
    const result = run(SEQUENCES.A1)
    expect(result.steps[0]!.gestures).toEqual([])
    expect(result.steps[0]!.effects).toEqual([{ kind: 'prevent-default' }, { kind: 'capture', pointerId: 1 }])
    expect(result.steps[1]!.gestures).toEqual([menu(101, 100)])
    expect(result.steps[1]!.effects).toEqual([{ kind: 'release-capture', pointerId: 1 }])
  })

  it('A2 Windows right-drag: a secondary-drag pan whose deltas sum to the travel, the first with the sub-slop offset; no menu', () => {
    const result = run(SEQUENCES.A2)
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:move', 'pan:move', 'pan:move', 'pan:end'])
    const pans = pansOf(result.gestures)
    expect(pans.every((pan) => pan.source === 'secondary-drag')).toBe(true)
    expect(pans[1]!.deltaPx).toEqual({ x: 20, y: 16 })
    expect(pans.reduce((sum, pan) => ({ x: sum.x + pan.deltaPx.x, y: sum.y + pan.deltaPx.y }), { x: 0, y: 0 })).toEqual({ x: 100, y: 80 })
    expect(pans[0]).toMatchObject({ phase: 'start', at: { x: 100, y: 100 } })
    expect(result.gestures.some((gesture) => gesture.kind === 'press' || gesture.kind === 'menu-request')).toBe(false)
  })

  it('A2 nothing pans within 3 px; the drag starts at the move that passes it', () => {
    const result = run(seq('right jitter then drag', WINDOWS, [
      down(100, 100, { button: 2 }),
      move(102, 100, { buttons: 2 }),
      move(103, 100, { buttons: 2 }),
      up(103, 100, { button: 2 }),
    ]))
    expect(result.steps[1]!.gestures).toEqual([])
    expect(kinds(result.steps[2]!.gestures)).toEqual(['pan:start', 'pan:move'])
    expect(kinds(result.gestures).at(-1)).toBe('pan:end')
  })

  it('A3 Linux right-click: as on Windows, one menu on up', () => {
    const result = run(SEQUENCES.A3)
    expect(result.gestures).toEqual([menu(100, 100)])
    expect(result.steps[1]!.gestures).toEqual([menu(100, 100)])
  })

  it.each([
    ['Linux', SEQUENCES.A4_LINUX],
    ['macOS', SEQUENCES.A4_MAC],
  ])('A4 %s right-drag: a pan, no menu', (_os, sequence) => {
    const result = run(sequence)
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:move', 'pan:end'])
    expect(result.gestures.some((gesture) => gesture.kind === 'menu-request')).toBe(false)
  })

  it('A5 Right press, pointerup lost: the move without its button ends the session, with no pan and no menu; the next press is fresh', () => {
    const result = run(SEQUENCES.A5)
    expect(result.steps[1]!.gestures).toEqual([{ kind: 'cancel', reason: 'pointercancel' }])
    // The source stops following the pointer, so its native menus are the page's again (B4).
    expect(result.steps[1]!.effects).toEqual([{ kind: 'release-capture', pointerId: 1 }, { kind: 'disown', pointerId: 1 }])
    expect(kinds(result.steps[2]!.gestures)).toEqual(['press'])
    expect(kinds(result.steps[3]!.gestures)).toEqual(['tap'])
  })

  it('A35 Drag end: a navigation session ends when its physical button leaves the move, a primary drag does not', () => {
    const middle = run(seq('middle pan, up lost', WINDOWS, [
      down(100, 100, { button: 1 }),
      move(120, 100, { buttons: 4 }),
      move(130, 100, { buttons: 0 }),
      move(140, 100, { buttons: 0 }),
    ]))
    expect(kinds(middle.gestures)).toEqual(['pan:start', 'pan:move', 'pan:end', 'cancel', 'hover'])
    const rotate = run(seq('Shift+right turn, up lost', WINDOWS, [
      down(100, 100, { button: 2, shift: true }),
      move(120, 100, { buttons: 2, shift: true }),
      move(130, 100, { buttons: 1, shift: true }),
    ]))
    // The lost release ends the turn where it is: the view keeps it.
    expect(kinds(rotate.gestures)).toEqual(['rotate:start', 'rotate:move', 'rotate:end', 'cancel'])
    // A Mac Control-drag holds the primary button: its moves keep the pan.
    const macPan = run(seq('Mac Control-drag', MAC_GESTURES, [
      down(100, 100, { ctrl: true }),
      move(120, 100, { buttons: 1, ctrl: true }),
      move(140, 100, { buttons: 1 }),
      move(150, 100, { buttons: 2 }),
    ]))
    expect(kinds(macPan.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:end', 'cancel'])
    const band = run(seq('band, up lost', WINDOWS, [
      down(100, 100),
      move(120, 100, { buttons: 1 }),
      move(130, 100, { buttons: 0 }),
    ]))
    expect(kinds(band.gestures)).toEqual(['press', 'drag-start', 'drag-move'])
  })

  it('A6 WKWebView capture then nothing: cancel(lost-capture), no menu, nothing stuck', () => {
    const result = run(SEQUENCES.A6)
    expect(result.gestures).toEqual([{ kind: 'cancel', reason: 'lost-capture' }])
    expect(result.state.sessions.size).toBe(0)
  })

  it('A7 Right-drag then pointercancel: the pan ends where it is, then cancel(pointercancel); no menu', () => {
    const result = run(SEQUENCES.A7)
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:end', 'cancel'])
    expect(result.gestures.at(-1)).toEqual({ kind: 'cancel', reason: 'pointercancel' })
    expect(result.state.sessions.size).toBe(0)
  })

  it.each(TOOLS)('A9 Right-drag under %s: a pan only; the tool hears no press or drag', (tool) => {
    const result = run(seq('A9', WINDOWS, SEQUENCES.A2.steps, { tool }))
    expect(result.gestures).toEqual(run(SEQUENCES.A2).gestures)
  })

  it('A10 Left pressed during a right-drag: the pan continues and no press reaches the tool', () => {
    const result = run(SEQUENCES.A10)
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:move', 'pan:move', 'pan:end'])
  })

  it('A11 a right press during a left drag is ignored: no pan and no menu; the band continues and commits', () => {
    const result = run(SEQUENCES.A11)
    expectNoNavigation(result.gestures)
    expect(kinds(result.gestures)).toEqual([
      'press', 'drag-start', 'drag-move', 'drag-move', 'drag-move', 'drag-move', 'drag-move', 'drag-end',
    ])
    expect(result.gestures.at(-1)).toEqual({ kind: 'drag-end', id: 1, at: { x: 145, y: 122 }, mods: expect.any(Object) })
  })

  it('A13 Shift+right-drag rotates about the press, stepped while mod is held, rightward raising the bearing', () => {
    const result = run(SEQUENCES.A13)
    const rotates = result.gestures.flatMap((gesture) => gesture.kind === 'rotate' ? [gesture] : [])
    expect(rotates.every((rotate) => rotate.source === 'secondary-drag' && rotate.anchorPx.x === 100 && rotate.anchorPx.y === 100)).toBe(true)
    expect(rotates.map((rotate) => [rotate.phase, rotate.step])).toEqual([
      ['start', false], ['move', false], ['move', false], ['move', false],
      ['move', true], ['move', true], ['move', true], ['move', true],
      ['move', false],
      ['end', false],
    ])
    expect(rotates.at(-1)!.totalDeltaDeg).toBeGreaterThan(0)
    expect(result.gestures.every((gesture) => gesture.kind === 'rotate')).toBe(true)
  })

  it('A14 Esc during a right rotate: rotate{cancel}, no menu', () => {
    const result = run(SEQUENCES.A14)
    expect(kinds(result.gestures)).toEqual(['rotate:start', 'rotate:move', 'rotate:move', 'rotate:move', 'rotate:cancel', 'cancel'])
    expect(result.gestures.at(-1)).toEqual({ kind: 'cancel', reason: 'escape' })
    expect(result.steps.at(-1)!.gestures).toEqual([])
  })

  it('a still Shift+right click opens the menu: Shift matters only past the slop', () => {
    const result = run(seq('still Shift+right click', WINDOWS, [
      down(100, 100, { button: 2, shift: true }),
      move(101, 101, { buttons: 2, shift: true }),
      up(101, 100, { button: 2, shift: true }),
    ]))
    expect(result.gestures).toEqual([menu(101, 100)])
  })

  it('A15 Right-click in the note editor: nothing is emitted or prevented', () => {
    const result = run(SEQUENCES.A15)
    expect(result.gestures).toEqual([])
    expect(result.effects).toEqual([])
  })

  it('A16 Right-click on a dock input: nothing is emitted or prevented', () => {
    const result = run(SEQUENCES.A16)
    expect(result.gestures).toEqual([])
    expect(result.effects).toEqual([])
  })

  it('A17 Esc during a right-drag pan: the pan ends at the Esc, the pointer only hovers after it, and the up opens no menu', () => {
    const result = run(SEQUENCES.A17)
    expect(result.steps[3]!.gestures).toEqual([
      { kind: 'pan', phase: 'end', deltaPx: { x: 0, y: 0 }, source: 'secondary-drag', at: { x: 140, y: 120 } },
      { kind: 'cancel', reason: 'escape' },
    ])
    expect(result.steps.slice(4, 6).map((step) => kinds(step.gestures))).toEqual([['hover'], ['hover']])
    expect(result.steps.at(-1)!.gestures).toEqual([])
  })

  it('A18 Shift after the press: a pan, not a rotate', () => {
    const result = run(SEQUENCES.A18)
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:end'])
  })
})

describe('recognise: 5.2 macOS Ctrl+click', () => {
  it('B1 macOS Ctrl+click: the menu at the release point, no press and no selection toggle', () => {
    const result = run(SEQUENCES.B1)
    expect(result.steps[0]!.input).toMatchObject({ kind: 'down', role: 'secondary', ctrlConsumed: true })
    expect(result.gestures).toEqual([{ kind: 'menu-request', at: { x: 100, y: 100 }, source: 'mouse' }])
  })

  it('B2 macOS Ctrl+drag: a pan, no band and no menu', () => {
    const result = run(SEQUENCES.B2)
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:move', 'pan:end'])
    expect(pansOf(result.gestures)[0]!.source).toBe('secondary-drag')
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

  it('B6 Mac Ctrl+Shift+click drag: a rotate, unstepped, stepped once Cmd is held; Ctrl never steps', () => {
    const result = run(SEQUENCES.B6)
    expect(result.gestures.map((gesture) => gesture.kind === 'rotate' && [gesture.phase, gesture.step])).toEqual([
      ['start', false], ['move', false], ['move', false],
      ['move', true], ['move', true], ['move', true],
    ])
  })

  it('B7 Mac Ctrl+drag never opens the menu: a pan, and its release requests none', () => {
    const result = run(SEQUENCES.B7)
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:move', 'pan:end'])
    expect(result.gestures.some((gesture) => gesture.kind === 'menu-request')).toBe(false)
  })
})

describe('recognise: 5.4 pen', () => {
  it('D1 Pen barrel tap: the menu at the release, source mouse', () => {
    const result = run(SEQUENCES.D1)
    expect(result.steps[0]!.input).toMatchObject({ kind: 'down', pointer: 'pen', role: 'secondary' })
    expect(result.gestures).toEqual([{ kind: 'menu-request', at: { x: 100, y: 100 }, source: 'mouse' }])
  })

  it('D2 Pen barrel drag: a pan', () => {
    const result = run(SEQUENCES.D2)
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:end'])
    expect(pansOf(result.gestures)[0]!.source).toBe('secondary-drag')
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

  it('D7 Pen barrel + Shift drag: a rotate, unstepped, then in 15° steps while mod is held', () => {
    const result = run(SEQUENCES.D7)
    expect(result.gestures.map((gesture) => gesture.kind === 'rotate' && [gesture.phase, gesture.step])).toEqual([
      ['start', false], ['move', false], ['move', false],
      ['move', true], ['move', true], ['move', true],
    ])
  })
})

describe('recognise: 5.5 touch and trackpad gestures', () => {
  it('E1 One-finger tap: nothing at the down; the press and its tap at the lift, both at the down point (A2); no hover left behind', () => {
    const result = run(SEQUENCES.E1)
    expect(result.steps.map((step) => kinds(step.gestures))).toEqual([[], [], ['press', 'tap']])
    expect(result.gestures).toEqual([
      { kind: 'press', id: 1, at: { x: 100, y: 100 }, pointer: 'touch', mods: NO_MODS, clickCount: 1, target: { kind: 'surface' } },
      { kind: 'tap', id: 1, at: { x: 100, y: 100 }, pointer: 'touch', mods: NO_MODS, clickCount: 1 },
    ])
    // The finger is held and captured from the down, so its moves reach the map.
    expect(result.steps[0]!.effects).toEqual([{ kind: 'prevent-default' }, { kind: 'capture', pointerId: 1 }])
  })

  it('E2 One-finger drag: nothing until 8 px, then the press at the down point and the drag, never a pan', () => {
    const result = run(SEQUENCES.E2)
    expect(result.steps.map((step) => kinds(step.gestures))).toEqual([[], ['press', 'drag-start'], ['drag-move'], ['drag-move'], ['drag-end']])
    expect(result.gestures[0]).toMatchObject({ kind: 'press', at: { x: 100, y: 100 } })
    const slow = run(seq('a slow finger', ANDROID, [
      down(100, 100, { pointer: 'touch' }),
      move(107, 100, { pointer: 'touch', buttons: 1 }),
      move(108, 100, { pointer: 'touch', buttons: 1 }),
    ]))
    expect(slow.steps.map((step) => kinds(step.gestures))).toEqual([[], [], ['press', 'drag-start']])
    expect(slow.gestures[1]).toMatchObject({ kind: 'drag-start', at: { x: 108, y: 100 } })
  })

  it('E3 Browser steals the touch: cancelled, no half band committed', () => {
    const result = run(SEQUENCES.E3)
    expect(kinds(result.gestures)).toEqual(['press', 'drag-start', 'cancel'])
    expect(result.gestures.at(-1)).toEqual({ kind: 'cancel', reason: 'pointercancel' })
    // A finger the browser takes before its slop: the host heard nothing, so nothing ends.
    const early = run(seq('stolen early', ANDROID, [down(100, 100, { pointer: 'touch' }), pointerCancel({ pointer: 'touch' })]))
    expect(early.gestures).toEqual([])
    expect(early.state.sessions.size).toBe(0)
  })

  it('E4 Two fingers: a second finger before the slop sends the host nothing; the fingers resume nothing', () => {
    const result = run(SEQUENCES.E4)
    expect(result.gestures.filter((gesture) => !NAVIGATION.has(gesture.kind))).toEqual([])
    // The second finger is captured too, and both lifts end their sessions.
    expect(result.steps[1]!.effects).toEqual([{ kind: 'prevent-default' }, { kind: 'capture', pointerId: 2 }])
    expect(result.state.sessions.size).toBe(0)
  })

  it('E5 Second finger after a drag started: the drag is cancelled (multitouch), and nothing resumes', () => {
    const result = run(SEQUENCES.E5)
    expect(result.steps.map((step) => kinds(step.gestures))).toEqual([
      [], ['press', 'drag-start'], ['drag-move'], ['drag-move'], ['cancel'], [], [], [], [],
    ])
    expect(result.gestures.at(-1)).toEqual({ kind: 'cancel', reason: 'multitouch' })
    expect(result.state.sessions.size).toBe(0)
  })

  it('E6 Long press on Android: no menu before phase 3 (the native contextmenu opens nothing), a tap', () => {
    expect(kinds(run(SEQUENCES.E6).gestures)).toEqual(['press', 'tap'])
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

  it('E12 iOS gesture events alongside pointers: one source of truth, the pointers; gesture events prevented', () => {
    const result = run(SEQUENCES.E12)
    expect(result.gestures.filter((gesture) => !NAVIGATION.has(gesture.kind))).toEqual([])
    expect(result.gestures.some((gesture) => gesture.kind === 'rotate' && gesture.source === 'trackpad-twist')).toBe(false)
    for (const index of [2, 3, 6]) expect(result.steps[index]!.effects).toEqual([{ kind: 'prevent-default' }])
  })

  it.each([
    ['Plant stamp', SEQUENCES.E13_PLANT_STAMP],
    ['Polygon', SEQUENCES.E13_POLYGON],
  ])('E13 Press-acting tools under a pinch (%s): no press reaches the host', (_tool, sequence) => {
    const result = run(sequence)
    expect(result.gestures.filter((gesture) => !NAVIGATION.has(gesture.kind))).toEqual([])
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

  it('F15b Wheel over a handle (U38): prevented, and zooms or pans as over the map, on every handle kind', () => {
    const mouse = run(SEQUENCES.F15B_MOUSE)
    expect(mouse.gestures).toEqual(Array(4).fill(run(SEQUENCES.F1).gestures[0]))
    expect(mouse.effects).toEqual(Array(4).fill({ kind: 'prevent-default' }))
    const trackpad = run(SEQUENCES.F15B_TRACKPAD)
    expect(trackpad.gestures).toEqual(Array(4).fill(run(SEQUENCES.F2).gestures[0]))
    expect(trackpad.effects).toEqual(Array(4).fill({ kind: 'prevent-default' }))
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

  it('G3b Space at a press on a handle: a space-drag pan; the handle is not dragged', () => {
    const result = run(SEQUENCES.G3B)
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:move', 'pan:end'])
    expect(pansOf(result.gestures)[0]!.source).toBe('space-drag')
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

  it.each([
    ['mouse', SEQUENCES.G7],
    ['touch', SEQUENCES.G7_TOUCH],
  ])('G7 Overview left drag (%s): a primary-drag pan; no press or tap reaches the host (U36)', (_pointer, sequence) => {
    const result = run(sequence)
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:move', 'pan:end'])
    expect(pansOf(result.gestures)[0]!.source).toBe('primary-drag')
    const clicked = run(seq('overview click', WINDOWS, [down(100, 100), up(100, 100)], { mode: 'overview' }))
    expect(clicked.gestures.some((gesture) => gesture.kind === 'press' || gesture.kind === 'tap')).toBe(false)
  })

  it('G8 Pan tool, pen tip drag: a primary-drag pan; the press ends with cancel(navigate)', () => {
    const result = run(SEQUENCES.G8_PEN)
    expect(kinds(result.gestures)).toEqual(['press', 'pan:start', 'pan:move', 'pan:move', 'pan:end', 'cancel'])
    expect(pansOf(result.gestures)[0]!.source).toBe('primary-drag')
    expect(result.gestures.at(-1)).toEqual({ kind: 'cancel', reason: 'navigate' })
  })

  it('G8 Pan tool, touch drag: past 8 px a primary-drag pan whose first move carries the whole travel; no press (A2)', () => {
    const result = run(SEQUENCES.G8_TOUCH)
    expect(result.steps.map((step) => kinds(step.gestures))).toEqual([[], ['pan:start', 'pan:move'], ['pan:move'], ['pan:end']])
    const pans = pansOf(result.gestures)
    expect(pans[0]).toMatchObject({ source: 'primary-drag', at: { x: 100, y: 100 } })
    expect(pans[1]!.deltaPx).toEqual({ x: 20, y: 10 })
    // A still Pan-tool tap reaches the host as a press and a tap at the lift.
    const tapped = run(seq('Pan-tool touch tap', ANDROID, [down(100, 100, { pointer: 'touch' }), up(102, 101, { pointer: 'touch' })], { tool: 'hand' }))
    expect(tapped.steps.map((step) => kinds(step.gestures))).toEqual([[], ['press', 'tap']])
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

  it('J3 Overview right-click: no menu; a right-drag pans', () => {
    expect(run(SEQUENCES.J3_RIGHT_CLICK).gestures).toEqual([])
    const rightDragged = run(SEQUENCES.J3_RIGHT_DRAG)
    expect(kinds(rightDragged.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:end'])
    expect(pansOf(rightDragged.gestures)[0]!.source).toBe('secondary-drag')
  })

  it('J9 Space with the Pan tool: a space-drag pan, the same result; no press reaches the tool', () => {
    const result = run(SEQUENCES.J9)
    expect(kinds(result.gestures)).toEqual(['pan:start', 'pan:move', 'pan:move', 'pan:move', 'pan:end'])
    expect(pansOf(result.gestures)[0]!.source).toBe('space-drag')
  })

  it('J10 a press with Space held pans and never reaches the probe', () => {
    const result = run(SEQUENCES.J10_SPACE)
    expect(result.gestures.some((gesture) => gesture.kind === 'press' || gesture.kind === 'tap')).toBe(false)
    expect(kinds(result.gestures)[0]).toBe('pan:start')
    expect(kinds(result.gestures).at(-1)).toBe('pan:end')
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

  it('a 7 px finger jitter is a tap at the down point; 8 px starts a drag', () => {
    const jitter = run(seq('touch jitter', ANDROID, [
      down(100, 100, { pointer: 'touch' }),
      move(107, 100, { pointer: 'touch', buttons: 1 }),
      move(100, 107, { pointer: 'touch', buttons: 1 }),
      up(104, 104, { pointer: 'touch' }),
    ]))
    expect(kinds(jitter.gestures)).toEqual(['press', 'tap'])
    expect(jitter.gestures[1]).toMatchObject({ kind: 'tap', at: { x: 100, y: 100 } })
    const dragged = run(seq('touch drag', ANDROID, [
      down(100, 100, { pointer: 'touch' }),
      move(108, 100, { pointer: 'touch', buttons: 1 }),
      up(108, 100, { pointer: 'touch' }),
    ]))
    expect(kinds(dragged.gestures)).toEqual(['press', 'drag-start', 'drag-end'])
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
      // The press is where it was; the drag starts at the move that passed the threshold.
      expect(dragged.gestures[0]).toMatchObject({ kind: 'press', at: { x: 100, y: 100 } })
      expect(dragged.gestures[1]).toMatchObject({ kind: 'drag-start', at: { x: 103, y: 100 } })
    }
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

  it('clickCount counts primary presses within 500 ms and 6 px when the platform sends detail 0', () => {
    const result = run(seq('detail 0 double-click', WINDOWS, [
      down(100, 100, { detail: 0, t: 0 }), up(100, 100, { t: 50 }),
      down(103, 102, { detail: 0, t: 200 }), up(103, 102, { t: 250 }),
      down(103, 102, { detail: 0, t: 1000 }), up(103, 102, { t: 1050 }),
      down(120, 100, { detail: 0, t: 1200 }), up(120, 100, { t: 1250 }),
    ]))
    const counts = result.gestures.flatMap((g) => g.kind === 'press' || g.kind === 'tap' ? [`${g.kind}:${g.clickCount}`] : [])
    expect(counts).toEqual(['press:1', 'tap:1', 'press:2', 'tap:2', 'press:1', 'tap:1', 'press:1', 'tap:1'])
  })

  it('clickCount keeps the platform\'s detail when it is higher, and a right press starts the count again', () => {
    const result = run(seq('platform double-click', WINDOWS, [
      down(100, 100, { detail: 2, t: 0 }), up(100, 100, { t: 50 }),
      down(100, 100, { button: 2, t: 100 }), up(100, 100, { button: 2, t: 150 }),
      down(100, 100, { detail: 0, t: 200 }), up(100, 100, { t: 250 }),
    ]))
    const presses = result.gestures.flatMap((g) => g.kind === 'press' ? [g.clickCount] : [])
    expect(presses).toEqual([2, 1])
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
