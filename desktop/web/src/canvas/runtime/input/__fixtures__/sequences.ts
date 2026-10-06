// canvas/runtime/input/__fixtures__/sequences.ts
//
// Owns the synthetic event sequences of spec §5: each is named by its id and title and runs through `normalise` and
// `recognise` with an injected platform, clock (each step's timeStamp) and thresholds. A sequence holds DOM-shaped
// literals (`DomEventLike`, with host-relative points and classified targets, as the DOM source hands them over) and the
// raw inputs that come from elsewhere (key state from the keyboard, escape from the Esc chain, the session's configure
// and reject). A spec sequence's native contextmenu never reaches the recogniser (the source's one listener prevents it,
// spec §2.2 "Native menu"), so the fixtures leave it out and dom-input-source.test.ts holds its orderings (A1, A3, A8,
// A11, A15, B7, C1–C5, D1). The expectations live in recognise.test.ts.

import type { CanvasDropPayload, ToolHandleId, ToolId } from '../../interaction-types'
import type { Gesture } from '../gestures'
import { normalise, type DomEventLike } from '../normalise'
import type { InputPlatform } from '../platform'
import type { AdapterEffect, RawInput, RecogniserState, TargetClass } from '../raw-input'
import { initialRecogniserState, recognise } from '../recognise'
import { DEFAULT_THRESHOLDS, type Thresholds } from '../thresholds'

export const WINDOWS: InputPlatform = Object.freeze({ os: 'windows', gestureEvents: false })
export const LINUX: InputPlatform = Object.freeze({ os: 'linux', gestureEvents: false })
export const MAC: InputPlatform = Object.freeze({ os: 'mac', gestureEvents: false })
/** Safari and WKWebView, which also send gesture events. */
export const MAC_GESTURES: InputPlatform = Object.freeze({ os: 'mac', gestureEvents: true })
export const IOS: InputPlatform = Object.freeze({ os: 'ios', gestureEvents: true })
export const ANDROID: InputPlatform = Object.freeze({ os: 'android', gestureEvents: false })

export const SURFACE: TargetClass = Object.freeze({ kind: 'surface' })
export const OWNED_TEXT: TargetClass = Object.freeze({ kind: 'owned-text' })
export const OWNED_CHROME: TargetClass = Object.freeze({ kind: 'owned-chrome' })
export const FOREIGN: TargetClass = Object.freeze({ kind: 'foreign' })
export const ROTATE_HANDLE: TargetClass = Object.freeze({ kind: 'handle', id: 'rotate' as ToolHandleId })
/** One of each canvas handle kind: a polygon corner, its midpoint dot, the rotate handle and a measurement guide's end. */
export const HANDLES: readonly TargetClass[] = Object.freeze([
  Object.freeze({ kind: 'handle', id: 'vertex:zone-1:0' as ToolHandleId }),
  Object.freeze({ kind: 'handle', id: 'edge-mid:zone-1:0' as ToolHandleId }),
  ROTATE_HANDLE,
  Object.freeze({ kind: 'handle', id: 'guide-end:guide-1:a' as ToolHandleId }),
]) as readonly TargetClass[]

export const HOST = Object.freeze({ width: 400, height: 300 })

export interface SequenceContext {
  readonly tool?: ToolId
  readonly mode?: 'site' | 'overview'
  readonly pointingDevice?: 'mouse' | 'trackpad'
}

/** One step: a DOM event, or a raw input that does not come from one. `t` is the step's clock (ms). */
export type FixtureStep =
  | { readonly t?: number; readonly dom: Omit<DomEventLike, 'timeStamp'> }
  | { readonly t?: number; readonly raw: DistributiveOmit<RawInput, 't'> }

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export interface Sequence {
  readonly name: string
  readonly platform: InputPlatform
  readonly context: SequenceContext
  readonly steps: readonly FixtureStep[]
}

export function seq(name: string, platform: InputPlatform, steps: readonly FixtureStep[], context: SequenceContext = {}): Sequence {
  return { name, platform, context, steps }
}

interface PointerOptions {
  readonly id?: number
  readonly pointer?: 'mouse' | 'pen' | 'touch'
  readonly button?: number
  readonly buttons?: number
  readonly detail?: number
  readonly shift?: boolean
  readonly ctrl?: boolean
  readonly alt?: boolean
  readonly meta?: boolean
  readonly target?: TargetClass
  readonly t?: number
}

function pointer(type: DomEventLike['type'], x: number, y: number, options: PointerOptions): FixtureStep {
  return {
    t: options.t,
    dom: {
      type,
      clientX: x,
      clientY: y,
      pointerId: options.id ?? 1,
      pointerType: options.pointer ?? 'mouse',
      button: options.button ?? 0,
      buttons: options.buttons,
      detail: options.detail,
      shiftKey: options.shift ?? false,
      ctrlKey: options.ctrl ?? false,
      altKey: options.alt ?? false,
      metaKey: options.meta ?? false,
      target: options.target ?? SURFACE,
    },
  }
}

export const down = (x: number, y: number, options: PointerOptions = {}): FixtureStep =>
  pointer('pointerdown', x, y, { detail: 1, ...options, buttons: options.buttons ?? buttonBit(options.button ?? 0) })
export const move = (x: number, y: number, options: PointerOptions = {}): FixtureStep =>
  pointer('pointermove', x, y, { ...options, button: -1, buttons: options.buttons ?? 0 })
export const up = (x: number, y: number, options: PointerOptions = {}): FixtureStep =>
  pointer('pointerup', x, y, { ...options, buttons: 0 })
export const pointerCancel = (options: PointerOptions = {}): FixtureStep => pointer('pointercancel', 0, 0, options)
export const lostCapture = (options: PointerOptions = {}): FixtureStep => pointer('lostpointercapture', 0, 0, options)
export const leave = (options: PointerOptions = {}): FixtureStep => pointer('pointerleave', 0, 0, options)

interface WheelOptions {
  readonly dx?: number
  readonly dy?: number
  readonly mode?: number
  readonly shift?: boolean
  readonly ctrl?: boolean
  readonly alt?: boolean
  readonly meta?: boolean
  readonly target?: TargetClass
  readonly t?: number
}

export function wheel(x: number, y: number, options: WheelOptions = {}): FixtureStep {
  return {
    t: options.t,
    dom: {
      type: 'wheel',
      clientX: x,
      clientY: y,
      deltaX: options.dx ?? 0,
      deltaY: options.dy ?? 0,
      deltaMode: options.mode ?? 0,
      shiftKey: options.shift ?? false,
      ctrlKey: options.ctrl ?? false,
      altKey: options.alt ?? false,
      metaKey: options.meta ?? false,
      target: options.target ?? SURFACE,
    },
  }
}

export function gesture(
  phase: 'start' | 'change' | 'end',
  rotation: number,
  options: { readonly t?: number } = {},
): FixtureStep {
  return {
    t: options.t,
    dom: {
      type: phase === 'start' ? 'gesturestart' : phase === 'change' ? 'gesturechange' : 'gestureend',
      clientX: 200,
      clientY: 150,
      rotation,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      target: SURFACE,
    },
  }
}

export function drag(
  phase: 'over' | 'leave' | 'drop',
  x: number,
  y: number,
  payload: CanvasDropPayload,
  options: { readonly t?: number } = {},
): FixtureStep {
  return {
    t: options.t,
    dom: {
      type: phase === 'over' ? 'dragover' : phase === 'leave' ? 'dragleave' : 'drop',
      clientX: x,
      clientY: y,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      target: SURFACE,
      dropPayload: payload,
    },
  }
}

export const keyState = (
  space: boolean,
  mods: { readonly shift?: boolean; readonly ctrl?: boolean; readonly alt?: boolean; readonly meta?: boolean } = {},
  options: { readonly t?: number } = {},
): FixtureStep => ({
  t: options.t,
  raw: {
    kind: 'key-state',
    space,
    mods: { shift: mods.shift ?? false, ctrl: mods.ctrl ?? false, alt: mods.alt ?? false, meta: mods.meta ?? false },
  },
})
export const escape = (options: { readonly t?: number } = {}): FixtureStep => ({ t: options.t, raw: { kind: 'escape' } })
export const blur = (options: { readonly t?: number } = {}): FixtureStep => ({ t: options.t, raw: { kind: 'cancel', id: 'all', reason: 'blur' } })
export const reject = (id = 1): FixtureStep => ({ raw: { kind: 'reject', id } })
export const configure = (context: Required<SequenceContext>): FixtureStep => ({ raw: { kind: 'configure', context } })

/** Two fingers 100 px apart about (200, 150), turned clockwise on screen by `deg`: their downs at 0°, their moves after. */
export function twist(deg: number): FixtureStep[] {
  const rad = (deg * Math.PI) / 180
  const dx = 50 * Math.cos(rad)
  const dy = 50 * Math.sin(rad)
  const at = (sign: 1 | -1, id: number) => [200 + sign * dx, 150 + sign * dy, { pointer: 'touch', id, buttons: 1 }] as const
  if (deg === 0) return [down(...at(1, 1)), down(...at(-1, 2))]
  return [move(...at(1, 1)), move(...at(-1, 2))]
}

/** A straight run of moves from one point to another, `count` samples after the start. */
export function moves(from: readonly [number, number], to: readonly [number, number], count: number, options: PointerOptions = {}): FixtureStep[] {
  const steps: FixtureStep[] = []
  for (let index = 1; index <= count; index += 1) {
    const x = from[0] + ((to[0] - from[0]) * index) / count
    const y = from[1] + ((to[1] - from[1]) * index) / count
    steps.push(move(x, y, options))
  }
  return steps
}

function buttonBit(button: number): number {
  if (button === 0) return 1
  if (button === 1) return 4
  if (button === 2) return 2
  if (button === 5) return 32
  return 0
}

export interface SequenceRun {
  readonly gestures: readonly Gesture[]
  readonly effects: readonly AdapterEffect[]
  /** Per step: what normalise made of it, and what recognise answered. */
  readonly steps: readonly {
    readonly input: RawInput | null
    readonly gestures: readonly Gesture[]
    readonly effects: readonly AdapterEffect[]
  }[]
  readonly state: RecogniserState
}

/** Runs a sequence through normalise and recognise, configuring its context first. Each step without a `t` is 16 ms on. */
export function runSequence(sequence: Sequence, thresholds: Thresholds = DEFAULT_THRESHOLDS): SequenceRun {
  const config = { platform: sequence.platform, thresholds }
  let state = recognise(initialRecogniserState(), {
    kind: 'configure',
    t: 0,
    context: {
      tool: sequence.context.tool ?? 'select',
      mode: sequence.context.mode ?? 'site',
      pointingDevice: sequence.context.pointingDevice ?? 'mouse',
    },
  }, config).state
  let clock = 0
  const steps: SequenceRun['steps'][number][] = []
  for (const step of sequence.steps) {
    clock = step.t ?? clock + 16
    const input = 'dom' in step
      ? normalise({ ...step.dom, timeStamp: clock }, sequence.platform, HOST)
      : { ...step.raw, t: clock } as RawInput
    if (!input) {
      steps.push({ input: null, gestures: [], effects: [] })
      continue
    }
    const result = recognise(state, input, config)
    state = result.state
    steps.push({ input, gestures: result.gestures, effects: result.effects })
  }
  return {
    gestures: steps.flatMap((step) => step.gestures),
    effects: steps.flatMap((step) => step.effects),
    steps,
    state,
  }
}

const SPECIES_PAYLOAD: CanvasDropPayload = Object.freeze({ kind: 'species', species: null })

/** Every sequence of spec §5, keyed by its id. */
export const SEQUENCES = {
  // 5.1 Secondary button
  A1: seq('A1 Windows right-click', WINDOWS, [
    down(100, 100, { button: 2 }),
    up(101, 100, { button: 2 }),
  ]),
  A2: seq('A2 Windows right-drag', WINDOWS, [
    down(100, 100, { button: 2 }),
    ...moves([100, 100], [200, 180], 5, { buttons: 2 }),
    up(200, 180, { button: 2 }),
  ]),
  A3: seq('A3 Linux right-click', LINUX, [
    down(100, 100, { button: 2 }),
    up(100, 100, { button: 2 }),
  ]),
  A4_LINUX: seq('A4 Linux right-drag', LINUX, [
    down(100, 100, { button: 2 }),
    ...moves([100, 100], [160, 100], 3, { buttons: 2 }),
    up(160, 100, { button: 2 }),
  ]),
  A4_MAC: seq('A4 macOS right-drag', MAC_GESTURES, [
    down(100, 100, { button: 2 }),
    ...moves([100, 100], [160, 100], 3, { buttons: 2 }),
    up(160, 100, { button: 2 }),
  ]),
  A5: seq('A5 Right press, pointerup lost', LINUX, [
    down(100, 100, { button: 2 }),
    move(140, 100, { buttons: 0 }),
    down(150, 100),
    up(150, 100),
  ]),
  A6: seq('A6 WKWebView capture then nothing', MAC_GESTURES, [
    down(100, 100, { button: 2 }),
    lostCapture(),
  ]),
  A7: seq('A7 Right-drag then pointercancel', WINDOWS, [
    down(100, 100, { button: 2 }),
    ...moves([100, 100], [140, 120], 2, { buttons: 2 }),
    pointerCancel(),
  ]),
  A10: seq('A10 Left pressed during a right-drag', WINDOWS, [
    down(100, 100, { button: 2 }),
    ...moves([100, 100], [130, 100], 2, { buttons: 2 }),
    move(140, 100, { buttons: 3 }),
    move(150, 100, { buttons: 2 }),
    up(150, 100, { button: 2 }),
  ]),
  A11: seq('A11 Right pressed during a left drag', LINUX, [
    down(100, 100),
    ...moves([100, 100], [120, 110], 2, { buttons: 1 }),
    move(125, 112, { buttons: 3 }),
    ...moves([125, 112], [140, 120], 2, { buttons: 3 }),
    move(145, 122, { buttons: 1 }),
    up(145, 122),
  ]),
  A13: seq('A13 Shift+right-drag with mod steps', WINDOWS, [
    down(100, 100, { button: 2, shift: true }),
    ...moves([100, 100], [130, 100], 3, { buttons: 2, shift: true }),
    keyState(false, { shift: true, ctrl: true }),
    ...moves([130, 100], [160, 100], 3, { buttons: 2, shift: true, ctrl: true }),
    keyState(false, { shift: true }),
    up(160, 100, { button: 2, shift: true }),
  ]),
  A14: seq('A14 Esc during a right rotate', WINDOWS, [
    down(100, 100, { button: 2, shift: true }),
    ...moves([100, 100], [130, 100], 3, { buttons: 2, shift: true }),
    escape(),
    up(130, 100, { button: 2, shift: true }),
  ]),
  A15: seq('A15 Right-click in the note editor', LINUX, [
    down(100, 100, { button: 2, target: OWNED_TEXT }),
    up(100, 100, { button: 2, target: OWNED_TEXT }),
  ]),
  A16: seq('A16 Right-click on a dock input', WINDOWS, [
    down(100, 100, { button: 2, target: FOREIGN }),
    up(100, 100, { button: 2, target: FOREIGN }),
  ]),
  A17: seq('A17 Esc during a right-drag pan', WINDOWS, [
    down(100, 100, { button: 2 }),
    ...moves([100, 100], [140, 120], 2, { buttons: 2 }),
    escape(),
    ...moves([140, 120], [160, 130], 2, { buttons: 2 }),
    up(160, 130, { button: 2 }),
  ]),
  A18: seq('A18 Shift after the press', WINDOWS, [
    down(100, 100, { button: 2 }),
    keyState(false, { shift: true }),
    ...moves([100, 100], [110, 100], 2, { buttons: 2, shift: true }),
    up(110, 100, { button: 2, shift: true }),
  ]),

  // 5.2 macOS Ctrl+click
  B1: seq('B1 macOS Ctrl+click', MAC_GESTURES, [
    down(100, 100, { ctrl: true }),
    up(100, 100, { ctrl: true }),
  ]),
  B2: seq('B2 macOS Ctrl+drag', MAC_GESTURES, [
    down(100, 100, { ctrl: true }),
    ...moves([100, 100], [150, 140], 3, { buttons: 1, ctrl: true }),
    up(150, 140, { ctrl: true }),
  ]),
  B3_WINDOWS: seq('B3 Ctrl+click on Windows', WINDOWS, [
    down(100, 100, { ctrl: true }),
    up(100, 100, { ctrl: true }),
  ]),
  B3_LINUX: seq('B3 Ctrl+click on Linux', LINUX, [
    down(100, 100, { ctrl: true }),
    up(100, 100, { ctrl: true }),
  ]),
  B4: seq('B4 macOS two-finger trackpad click', MAC_GESTURES, [
    down(100, 100, { button: 2 }),
    up(100, 100, { button: 2 }),
  ]),
  B6: seq('B6 Mac Ctrl+Shift+click drag', MAC_GESTURES, [
    down(100, 100, { ctrl: true, shift: true }),
    ...moves([100, 100], [120, 100], 2, { buttons: 1, ctrl: true, shift: true }),
    keyState(false, { ctrl: true, shift: true, meta: true }),
    ...moves([120, 100], [140, 100], 2, { buttons: 1, ctrl: true, shift: true, meta: true }),
  ]),
  B7: seq('B7 Mac Ctrl+drag never opens the menu', MAC_GESTURES, [
    down(100, 100, { ctrl: true }),
    ...moves([100, 100], [150, 140], 3, { buttons: 1, ctrl: true }),
    up(150, 140, { ctrl: true }),
  ]),

  // 5.4 Pen
  D1: seq('D1 Pen barrel tap', WINDOWS, [
    down(100, 100, { pointer: 'pen', button: 2 }),
    up(100, 100, { pointer: 'pen', button: 2 }),
  ]),
  D2: seq('D2 Pen barrel drag', WINDOWS, [
    down(100, 100, { pointer: 'pen', button: 2 }),
    ...moves([100, 100], [140, 100], 2, { pointer: 'pen', buttons: 2 }),
    up(140, 100, { pointer: 'pen', button: 2 }),
  ]),
  D3: seq('D3 Pen tip draw', WINDOWS, [
    down(100, 100, { pointer: 'pen' }),
    ...moves([100, 100], [150, 120], 4, { pointer: 'pen', buttons: 1 }),
    up(150, 120, { pointer: 'pen' }),
  ]),
  D4: seq('D4 Eraser', WINDOWS, [
    down(100, 100, { pointer: 'pen', button: 5, buttons: 32 }),
    up(100, 100, { pointer: 'pen', button: 5 }),
  ]),
  D5: seq('D5 Pen hover', WINDOWS, moves([100, 100], [130, 100], 3, { pointer: 'pen', buttons: 0 })),
  D6: seq('D6 Wacom as mouse (Firefox on Linux)', LINUX, [
    down(100, 100),
    ...moves([100, 100], [150, 120], 4, { buttons: 1 }),
    up(150, 120),
  ]),
  D7: seq('D7 Pen barrel + Shift drag', WINDOWS, [
    down(100, 100, { pointer: 'pen', button: 2, shift: true }),
    ...moves([100, 100], [120, 100], 2, { pointer: 'pen', buttons: 2, shift: true }),
    keyState(false, { shift: true, ctrl: true }),
    ...moves([120, 100], [140, 100], 2, { pointer: 'pen', buttons: 2, shift: true, ctrl: true }),
  ]),

  // 5.5 Touch and trackpad gestures
  E1: seq('E1 One-finger tap', ANDROID, [
    down(100, 100, { pointer: 'touch' }),
    move(104, 103, { pointer: 'touch', buttons: 1 }),
    up(105, 104, { pointer: 'touch' }),
  ]),
  E2: seq('E2 One-finger drag', ANDROID, [
    down(100, 100, { pointer: 'touch' }),
    ...moves([100, 100], [150, 100], 3, { pointer: 'touch', buttons: 1 }),
    up(150, 100, { pointer: 'touch' }),
  ]),
  E3: seq('E3 Browser steals the touch', ANDROID, [
    down(100, 100, { pointer: 'touch' }),
    ...moves([100, 100], [110, 100], 2, { pointer: 'touch', buttons: 1 }),
    pointerCancel({ pointer: 'touch' }),
  ]),
  E4: seq('E4 Two-finger pan, zoom, turn', ANDROID, [
    down(100, 100, { pointer: 'touch', id: 1 }),
    down(200, 100, { pointer: 'touch', id: 2 }),
    move(110, 110, { pointer: 'touch', id: 1, buttons: 1 }),
    move(220, 110, { pointer: 'touch', id: 2, buttons: 1 }),
    move(120, 120, { pointer: 'touch', id: 1, buttons: 1 }),
    move(240, 120, { pointer: 'touch', id: 2, buttons: 1 }),
    up(240, 120, { pointer: 'touch', id: 2 }),
    up(120, 120, { pointer: 'touch', id: 1 }),
  ]),
  E5: seq('E5 Second finger after a drag started', ANDROID, [
    down(100, 100, { pointer: 'touch', id: 1 }),
    ...moves([100, 100], [130, 100], 3, { pointer: 'touch', id: 1, buttons: 1 }),
    down(200, 100, { pointer: 'touch', id: 2 }),
    move(140, 100, { pointer: 'touch', id: 1, buttons: 1 }),
    move(210, 100, { pointer: 'touch', id: 2, buttons: 1 }),
    up(210, 100, { pointer: 'touch', id: 2 }),
    up(140, 100, { pointer: 'touch', id: 1 }),
  ]),
  E7: seq('E7 Long press', IOS, [
    down(100, 100, { pointer: 'touch', t: 0 }),
    move(104, 102, { pointer: 'touch', buttons: 1, t: 200 }),
    { t: 500, raw: { kind: 'tick' } },
    move(140, 100, { pointer: 'touch', buttons: 1, t: 550 }),
    down(200, 100, { pointer: 'touch', id: 2, t: 560 }),
    up(200, 100, { pointer: 'touch', id: 2, t: 600 }),
    up(140, 100, { pointer: 'touch', t: 650 }),
  ]),
  E8: seq('E8 Long press with movement', ANDROID, [
    down(100, 100, { pointer: 'touch', t: 0 }),
    move(115, 100, { pointer: 'touch', buttons: 1, t: 200 }),
    { t: 500, raw: { kind: 'tick' } },
    up(115, 100, { pointer: 'touch', t: 700 }),
  ]),
  E15_PINCH: seq('E15 Touch in overview: a pinch', ANDROID, [
    down(100, 100, { pointer: 'touch', id: 1 }),
    down(200, 100, { pointer: 'touch', id: 2 }),
    move(80, 100, { pointer: 'touch', id: 1, buttons: 1 }),
    move(220, 100, { pointer: 'touch', id: 2, buttons: 1 }),
    up(220, 100, { pointer: 'touch', id: 2 }),
    up(80, 100, { pointer: 'touch', id: 1 }),
  ], { mode: 'overview' }),
  E16_THIRD_FINGER: seq('E16 A third finger', ANDROID, [
    down(100, 100, { pointer: 'touch', id: 1 }),
    down(200, 100, { pointer: 'touch', id: 2 }),
    down(150, 200, { pointer: 'touch', id: 3 }),
    move(160, 200, { pointer: 'touch', id: 3, buttons: 1 }),
    move(110, 100, { pointer: 'touch', id: 1, buttons: 1 }),
    up(160, 200, { pointer: 'touch', id: 3 }),
    up(110, 100, { pointer: 'touch', id: 1 }),
    up(200, 100, { pointer: 'touch', id: 2 }),
  ]),
  E16_BLUR: seq('E16 A pinch-twist of 40°, then blur', ANDROID, [
    ...twist(0),
    ...twist(20),
    ...twist(40),
    blur(),
  ]),
  E9: seq('E9 Trackpad pinch with rotation drift', MAC_GESTURES, [
    gesture('start', 0),
    gesture('change', 4),
    gesture('change', -4),
    gesture('end', -4),
  ]),
  E10: seq('E10 Deliberate trackpad twist', MAC_GESTURES, [
    gesture('start', 0),
    gesture('change', 5),
    gesture('change', 12),
    gesture('change', 20),
    gesture('end', 20),
  ]),
  E12: seq('E12 iOS gesture events alongside pointers', IOS, [
    down(100, 100, { pointer: 'touch', id: 1 }),
    down(200, 100, { pointer: 'touch', id: 2 }),
    gesture('start', 0),
    gesture('change', 10),
    move(110, 100, { pointer: 'touch', id: 1, buttons: 1 }),
    move(230, 100, { pointer: 'touch', id: 2, buttons: 1 }),
    gesture('end', 10),
    up(230, 100, { pointer: 'touch', id: 2 }),
    up(110, 100, { pointer: 'touch', id: 1 }),
  ]),
  E13_PLANT_STAMP: seq('E13 Press-acting tools under a pinch (Plant stamp)', ANDROID, [
    down(100, 100, { pointer: 'touch', id: 1, t: 0 }),
    down(200, 100, { pointer: 'touch', id: 2, t: 40 }),
    move(90, 100, { pointer: 'touch', id: 1, buttons: 1 }),
    move(220, 100, { pointer: 'touch', id: 2, buttons: 1 }),
  ], { tool: 'plant-stamp' }),
  E13_POLYGON: seq('E13 Press-acting tools under a pinch (Polygon)', ANDROID, [
    down(100, 100, { pointer: 'touch', id: 1, t: 0 }),
    down(200, 100, { pointer: 'touch', id: 2, t: 40 }),
    move(90, 100, { pointer: 'touch', id: 1, buttons: 1 }),
    move(220, 100, { pointer: 'touch', id: 2, buttons: 1 }),
  ], { tool: 'polygon' }),
  E14_PLANT_STAMP: seq('E14 Press-acting tools under a long press (Plant stamp)', ANDROID, [
    down(100, 100, { pointer: 'touch', t: 0 }),
    { t: 500, raw: { kind: 'tick' } },
    up(100, 100, { pointer: 'touch', t: 650 }),
  ], { tool: 'plant-stamp' }),
  E14_POLYGON: seq('E14 Press-acting tools under a long press (Polygon)', ANDROID, [
    down(100, 100, { pointer: 'touch', t: 0 }),
    { t: 500, raw: { kind: 'tick' } },
    up(100, 100, { pointer: 'touch', t: 650 }),
  ], { tool: 'polygon' }),
  E15_OVERVIEW: seq('E15 Touch in overview: hold, then drag 120 px', ANDROID, [
    down(100, 100, { pointer: 'touch', t: 0 }),
    { t: 500, raw: { kind: 'tick' } },
    up(100, 100, { pointer: 'touch', t: 600 }),
    down(100, 100, { pointer: 'touch', t: 1000 }),
    move(160, 100, { pointer: 'touch', buttons: 1, t: 1020 }),
    move(220, 100, { pointer: 'touch', buttons: 1, t: 1040 }),
    up(220, 100, { pointer: 'touch', t: 1060 }),
  ], { mode: 'overview' }),
  E15_PAN_TOOL: seq('E15 Touch with the Pan tool: hold', ANDROID, [
    down(100, 100, { pointer: 'touch', t: 0 }),
    { t: 500, raw: { kind: 'tick' } },
    up(100, 100, { pointer: 'touch', t: 600 }),
  ], { tool: 'hand' }),

  // 5.6 Wheel and trackpad
  F1: seq('F1 Windows wheel notch, Mouse', WINDOWS, [wheel(120, 80, { dy: 100 })]),
  F2: seq('F2 Windows wheel notch, Trackpad', WINDOWS, [wheel(120, 80, { dy: 100 })], { pointingDevice: 'trackpad' }),
  F3: seq('F3 Firefox line mode', LINUX, [wheel(120, 80, { dy: 3, mode: 1 })]),
  F4_MOUSE: seq('F4 Chromium pinch (synthetic Ctrl), Mouse', MAC, [wheel(120, 80, { dy: -2.3, ctrl: true })]),
  F4_TRACKPAD: seq('F4 Chromium pinch (synthetic Ctrl), Trackpad', MAC, [wheel(120, 80, { dy: -2.3, ctrl: true })], { pointingDevice: 'trackpad' }),
  F5: seq('F5 Real Ctrl + wheel', WINDOWS, [
    keyState(false, { ctrl: true }),
    wheel(120, 80, { dy: 100, ctrl: true }),
    keyState(false),
  ], { pointingDevice: 'trackpad' }),
  F6: seq('F6 Trackpad scroll, Trackpad', MAC_GESTURES, [wheel(120, 80, { dx: 3.5, dy: -7.25 })], { pointingDevice: 'trackpad' }),
  F7: seq('F7 Trackpad scroll, Mouse', MAC_GESTURES, [wheel(120, 80, { dx: 3.5, dy: -7.25 })]),
  F8: seq('F8 Shift + wheel, Trackpad, one axis', WINDOWS, [wheel(120, 80, { dy: 100, shift: true })], { pointingDevice: 'trackpad' }),
  F9: seq('F9 Shift + wheel, macOS swapped', MAC_GESTURES, [wheel(120, 80, { dx: 100, shift: true })], { pointingDevice: 'trackpad' }),
  F10: seq('F10 Shift + wheel, Mouse', WINDOWS, [wheel(120, 80, { dy: 100, shift: true })]),
  F10B: seq('F10b Shift + wheel delivered as dx', WINDOWS, [wheel(120, 80, { dx: 100, shift: true })]),
  F11: seq('F11 WKWebView pinch and rotate', MAC_GESTURES, [
    gesture('start', 0),
    gesture('change', 5),
    gesture('change', 12),
    gesture('end', 12),
  ]),
  F12: seq('F12 WKWebView pinch with Ctrl wheels', MAC_GESTURES, [
    gesture('start', 0),
    wheel(200, 150, { dy: -3, ctrl: true }),
    gesture('change', 0),
    wheel(200, 150, { dy: -3, ctrl: true }),
    gesture('end', 0),
  ]),
  F14: seq('F14 Momentum tail', MAC_GESTURES, [
    ...Array.from({ length: 10 }, (_, index) => wheel(120, 80, { dy: 4 - index * 0.3, t: 16 * (index + 1) })),
    down(120, 80, { t: 170 }),
    ...Array.from({ length: 10 }, (_, index) => wheel(120, 80, { dy: 1 - index * 0.1, t: 176 + 16 * index })),
    up(120, 80, { t: 400 }),
  ]),
  F15: seq('F15 Wheel over owned text', WINDOWS, [wheel(120, 80, { dy: 100, target: OWNED_TEXT })]),
  F15B_MOUSE: seq('F15b Wheel over a handle, Mouse', WINDOWS, HANDLES.map((target) => wheel(120, 80, { dy: 100, target }))),
  F15B_TRACKPAD: seq('F15b Wheel over a handle, Trackpad', WINDOWS, HANDLES.map((target) => wheel(120, 80, { dy: 100, target })),
    { pointingDevice: 'trackpad' }),
  F16: seq('F16 Page mode', WINDOWS, [
    wheel(120, 80, { dy: 1, mode: 2 }),
    wheel(120, 80, { dx: 0.25, mode: 2 }),
  ], { pointingDevice: 'trackpad' }),
  F17: seq('F17 Alt + wheel', WINDOWS, [wheel(120, 80, { dy: 100, alt: true })]),
  F18: seq('F18 Wheel during a pointer rotate', WINDOWS, [
    down(100, 100, { button: 1, shift: true }),
    ...moves([100, 100], [120, 100], 2, { buttons: 4, shift: true }),
    wheel(120, 100, { dy: 100 }),
    ...moves([120, 100], [140, 100], 2, { buttons: 4, shift: true }),
    up(140, 100, { button: 1, shift: true }),
  ]),

  // 5.7 Middle button and Space
  G1: seq('G1 Middle-drag', LINUX, [
    down(100, 100, { button: 1 }),
    ...moves([100, 100], [130, 120], 3, { buttons: 4 }),
    up(130, 120, { button: 1 }),
  ]),
  G2: seq('G2 Middle-click on Linux', LINUX, [
    down(100, 100, { button: 1 }),
    up(100, 100, { button: 1 }),
  ]),
  G3: seq('G3 Space+drag', WINDOWS, [
    keyState(true),
    keyState(true),
    keyState(true),
    down(100, 100),
    ...moves([100, 100], [140, 90], 4, { buttons: 1 }),
    up(140, 90),
    keyState(false),
  ]),
  G3B: seq('G3b Space at a press on a handle', WINDOWS, [
    keyState(true),
    down(100, 100, { target: ROTATE_HANDLE }),
    ...moves([100, 100], [130, 100], 3, { buttons: 1 }),
    up(130, 100),
    keyState(false),
  ]),
  G4: seq('G4 Space then alt-tab', WINDOWS, [
    keyState(true),
    blur(),
    down(100, 100),
    ...moves([100, 100], [130, 100], 3, { buttons: 1 }),
    up(130, 100),
  ]),
  // No visibilitychange listener under LEGACY: the hidden step never reaches the recogniser, so Space stays held.
  G5: seq('G5 Stale Space', WINDOWS, [
    keyState(true),
    down(100, 100),
    ...moves([100, 100], [130, 100], 3, { buttons: 1 }),
    up(130, 100),
  ]),
  G6: seq('G6 X11 autorepeat pairs', LINUX, [
    keyState(true),
    down(100, 100),
    move(110, 100, { buttons: 1 }),
    keyState(false, {}, { t: 60 }),
    keyState(true, {}, { t: 60 }),
    move(120, 100, { buttons: 1, t: 76 }),
    up(120, 100),
    keyState(false),
  ]),
  G7: seq('G7 Overview left drag', WINDOWS, [
    down(100, 100),
    ...moves([100, 100], [150, 130], 3, { buttons: 1 }),
    up(150, 130),
  ], { mode: 'overview' }),
  G7_TOUCH: seq('G7 Overview one-finger drag', ANDROID, [
    down(100, 100, { pointer: 'touch' }),
    ...moves([100, 100], [150, 130], 3, { pointer: 'touch', buttons: 1 }),
    up(150, 130, { pointer: 'touch' }),
  ], { mode: 'overview' }),
  G8_PEN: seq('G8 Pan tool, pen tip drag', WINDOWS, [
    down(100, 100, { pointer: 'pen' }),
    ...moves([100, 100], [140, 120], 2, { pointer: 'pen', buttons: 1 }),
    up(140, 120, { pointer: 'pen' }),
  ], { tool: 'hand' }),
  G8_TOUCH: seq('G8 Pan tool, touch drag', ANDROID, [
    down(100, 100, { pointer: 'touch' }),
    ...moves([100, 100], [140, 120], 2, { pointer: 'touch', buttons: 1 }),
    up(140, 120, { pointer: 'touch' }),
  ], { tool: 'hand' }),
  G9: seq('G9 Shift+middle-drag rotates', WINDOWS, [
    down(100, 100, { button: 1, shift: true }),
    move(102, 100, { buttons: 4, shift: true }),
    move(120, 100, { buttons: 4, shift: true }),
    up(120, 100, { button: 1, shift: true }),
  ]),
  G9B: seq('G9b Still Shift+middle click', WINDOWS, [
    down(100, 100, { button: 1, shift: true }),
    move(101, 101, { buttons: 4, shift: true }),
    up(102, 100, { button: 1, shift: true }),
  ]),
  G9C: seq('G9c Shift+middle-drag in overview', WINDOWS, [
    down(100, 100, { button: 1, shift: true }),
    move(102, 100, { buttons: 4, shift: true }),
    move(120, 100, { buttons: 4, shift: true }),
    up(120, 100, { button: 1, shift: true }),
  ], { mode: 'overview' }),
  // Space pressed while a rail button has focus stays with the button: no key state reaches the recogniser.
  G10: seq('G10 Space while a rail button has focus', WINDOWS, [
    down(100, 100),
    ...moves([100, 100], [130, 100], 3, { buttons: 1 }),
    up(130, 100),
  ]),

  // 5.9 Precedence
  J1_SELECT: seq('J1 Left-drag never pans (Select)', WINDOWS, [
    down(100, 100),
    ...moves([100, 100], [150, 150], 3, { buttons: 1 }),
    up(150, 150),
  ]),
  J1_HAND: seq('J1 Left-drag never pans (Pan tool)', WINDOWS, [
    down(100, 100),
    ...moves([100, 100], [150, 150], 3, { buttons: 1 }),
    up(150, 150),
  ], { tool: 'hand' }),
  J2: seq('J2 Shift+drag is not box zoom', WINDOWS, [
    down(100, 100, { shift: true }),
    ...moves([100, 100], [150, 150], 3, { buttons: 1, shift: true }),
    up(150, 150, { shift: true }),
  ]),
  J3_RIGHT_CLICK: seq('J3 Overview right-click', WINDOWS, [
    down(100, 100, { button: 2 }),
    up(100, 100, { button: 2 }),
  ], { mode: 'overview' }),
  J3_RIGHT_DRAG: seq('J3 Overview right-drag', WINDOWS, [
    down(100, 100, { button: 2 }),
    ...moves([100, 100], [140, 130], 2, { buttons: 2 }),
    up(140, 130, { button: 2 }),
  ], { mode: 'overview' }),
  J9: seq('J9 Space with the Pan tool', WINDOWS, [
    keyState(true),
    down(100, 100),
    ...moves([100, 100], [150, 150], 3, { buttons: 1 }),
    up(150, 150),
    keyState(false),
  ], { tool: 'hand' }),
  J10_SPACE: seq('J10 Space held, down(0) then drag', WINDOWS, [
    keyState(true),
    down(100, 100),
    ...moves([100, 100], [130, 100], 3, { buttons: 1 }),
    up(130, 100),
  ]),

  // Drops: the drag cue is the host's; the recogniser forwards the phases and prevents dragover and drop.
  DROP: seq('Drop from a panel', WINDOWS, [
    drag('over', 100, 100, SPECIES_PAYLOAD),
    drag('over', 110, 100, SPECIES_PAYLOAD),
    drag('leave', 110, 100, SPECIES_PAYLOAD),
    drag('drop', 120, 100, SPECIES_PAYLOAD),
  ]),
} satisfies Record<string, Sequence>
