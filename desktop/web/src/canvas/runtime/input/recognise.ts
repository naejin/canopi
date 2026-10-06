// canvas/runtime/input/recognise.ts  (the recogniser: its two state types and its two functions)
//
// Owns gesture recognition: a pure reducer from one RawInput to gestures and the effects the DOM source applies to the
// event it is handling. No clock, timer or DOM: time is `RawInput.t`, the platform and bindings come in the config.
// PointerSession and TouchPair are type exports imported only inside input/; RecogniserState is opaque to callers.
// raw-input.ts and recognise.ts import each other's types with `import type` only (no runtime cycle).
//
// It implements the input of CURRENT_BINDINGS (spec §2.2 and §5): one pointer session at a time;
// a secondary press (the right button) pending until it passes 3 px: a still release opens the menu at the release point
// (none in overview), a drag pans, and with Shift at the press it turns the view, stepped while mod is held; no native
// contextmenu reaches it (the DOM source's listener prevents them); a middle drag, a Space press, overview and the Pan tool
// pan (a primary press on a handle drags the handle first), a pointer pan carrying the pointer's point and a Pan-tool press
// ending with cancel('navigate') after its drag; a Shift+middle drag rotating about its press once it passes 3 px (silent
// before, so a still click turns nothing), stepped while mod is held, with the wheel ignored while a pointer rotate lives;
// a button-less move over owned chrome, the text entry or a handle ends the hover; wheels zoom or pan by the
// pointing-device setting; a WebKit trackpad twist rotating past 10° as a session of its own; no touch gestures or pen
// barrel. Touch gestures and the long press arrive in phase 3.

import type { CancelReason, Modifiers, PointerKind } from '../interaction-types'
import { ROTATE_DEG_PER_PX } from '../view/navigation-policy'
import type { ScreenPoint } from '../view/types'
import type { Gesture, NavigationSource, PressTarget } from './gestures'
import { modKeyIsCmd, type InputPlatform } from './platform'
import type { AdapterEffect, ButtonRole, RawInput, RecogniserConfig, RecogniserState } from './raw-input'

export interface PointerSession {
  readonly pointerId: number
  readonly pointer: PointerKind
  readonly role: ButtonRole
  /** 'pending' is a primary press within slop; 'secondary' a secondary press within 3 px (a menu on release, a pan past
   *  it); 'primary' a primary drag past slop; 'pan' a navigation pan; 'rotate' a rotate, which turns the view only once
   *  `slopPassed` (until then it is pending and silent, and a secondary one still opens the menu on release). */
  readonly mode: 'pending' | 'secondary' | 'primary' | 'pan' | 'rotate'
  readonly start: ScreenPoint
  readonly last: ScreenPoint
  readonly slopPassed: boolean
  readonly captured: boolean
  /** The pan's or the rotate's source while `mode` is 'pan' or 'rotate'. */
  readonly navigation: NavigationSource | null
  /** True when a `press` reached the host, which owes it one end: a `tap` within slop, else `cancel('navigate')` for a pan
   *  (the Pan tool's press). */
  readonly pressed: boolean
  /** The platform's pointerdown `detail`, as delivered (never counted here under LEGACY). */
  readonly clickCount: number
}

export interface TouchPair {
  readonly ids: readonly [number, number]
  readonly startCentroid: ScreenPoint
  readonly startDistancePx: number
  readonly startAngleDeg: number
  readonly twistDeg: number
}

const ZERO: ScreenPoint = Object.freeze({ x: 0, y: 0 })
/** Wheel zoom: today's exp(clamp(−dy × 0.002, ±1)) per event. */
const WHEEL_ZOOM_PER_PX = 0.002
/** A secondary press, and a pointer rotate, start past this travel from the press (MapLibre's clickTolerance); a tool's
 *  own slop never applies. */
const NAVIGATION_SLOP_PX = 3
/** The session id of a WebKit trackpad twist, which has no pointer: browsers number pointers from 0. */
const TRACKPAD_TWIST_ID = -1

export function initialRecogniserState(): RecogniserState {
  return {
    sessions: new Map(),
    touchPair: null,
    held: { space: false },
    trackpadTwistDeg: 0,
    deadlines: { longPressAt: null },
    context: { tool: 'select', mode: 'site', pointingDevice: 'mouse' },
  }
}

interface Step {
  state: RecogniserState
  readonly gestures: Gesture[]
  readonly effects: AdapterEffect[]
}

export function recognise(
  state: RecogniserState,
  input: RawInput,
  config: RecogniserConfig,
): { readonly state: RecogniserState; readonly gestures: readonly Gesture[]; readonly effects: readonly AdapterEffect[] } {
  const step: Step = { state, gestures: [], effects: [] }
  switch (input.kind) {
    case 'down': down(step, input, config); break
    case 'move': move(step, input, config); break
    case 'up': up(step, input, config); break
    case 'cancel': cancel(step, input); break
    case 'reject': reject(step, input.id); break
    case 'leave': step.gestures.push({ kind: 'hover-end' }); break
    case 'escape':
      endLiveSessions(step, 'escape')
      releaseSpace(step)
      break
    case 'key-state':
      step.state = { ...step.state, held: { space: input.space } }
      restepRotate(step, input.mods, config.platform)
      break
    case 'configure': configure(step, input.context); break
    case 'wheel': wheel(step, input); break
    case 'drop':
      // Dragover and drop are always default-prevented (the drop target); dragleave is only observed.
      if (input.phase !== 'leave') step.effects.push({ kind: 'prevent-default' })
      step.gestures.push({ kind: 'drop', phase: input.phase, at: input.at, payload: input.payload })
      break
    case 'platform-gesture': platformGesture(step, input, config); break
    case 'focus-out':
      // The session ends the nudge series (ToolHost.endNudgeSeries); no pointer state changes.
      break
    case 'tick':
      // Deadlines (the long press, phase 3) are all null under LEGACY.
      break
  }
  return { state: step.state, gestures: step.gestures, effects: step.effects }
}

type RawOf<K extends RawInput['kind']> = Extract<RawInput, { kind: K }>

function down(step: Step, input: RawOf<'down'>, config: RecogniserConfig): void {
  // The note editor, the canvas's own buttons and fields, and anything outside the map keep their own presses.
  if (input.target.kind === 'owned-text' || input.target.kind === 'owned-chrome' || input.target.kind === 'foreign') return

  const live = step.state.sessions.get(input.id)
  // One pointer session at a time: a second pointer (a second touch) is ignored for the rest of the session.
  if (step.state.sessions.size > 0 && !live) return
  // A down for a live pointer id: its up was lost. End that session first.
  if (live) endSession(step, live, 'pointercancel')

  const { bindings } = config
  const { context, held } = step.state
  const base = {
    pointerId: input.id,
    pointer: input.pointer,
    role: input.role,
    start: input.at,
    last: input.at,
    slopPassed: false,
    clickCount: input.detail,
  } as const

  const pressTarget: PressTarget = input.target.kind === 'handle' ? { kind: 'handle', id: input.target.id } : { kind: 'surface' }
  const panIn = (panContext: 'hand-tool' | 'overview'): boolean => bindings.primaryDragPansIn.includes(panContext)

  if (input.role === 'secondary') {
    // Pending and silent until it passes 3 px, in every tool and in overview: a still release opens the menu, a drag
    // pans, or turns the view when Shift was held at the press (only Shift at the press decides; spec §2.2).
    step.effects.push({ kind: 'prevent-default' }, { kind: 'capture', pointerId: input.id })
    putSession(step, { ...base, mode: input.mods.shift ? 'rotate' : 'secondary', captured: true, navigation: 'secondary-drag', pressed: false })
    return
  }

  if (input.role === 'auxiliary' && input.mods.shift && bindings.auxiliaryShiftDrag === 'rotate') {
    // Shift+middle (checked before overview, fixture G9c): a pending rotate, silent until it passes its slop, so a still
    // click turns nothing (G9b). Shift at the press decides the mode for the whole session.
    step.effects.push({ kind: 'prevent-default' }, { kind: 'capture', pointerId: input.id })
    putSession(step, { ...base, mode: 'rotate', captured: true, navigation: 'auxiliary-drag', pressed: false })
    return
  }

  let navigation: NavigationSource | null = null
  let pressed = true
  if (context.mode === 'overview' && (input.role === 'auxiliary' || panIn('overview'))) {
    // Legacy overview: a left or plain middle press pans the map, whatever is under it; a pan never reaches the host.
    navigation = input.role === 'auxiliary' ? 'auxiliary-drag' : 'primary-drag'
    pressed = false
  } else if (input.role === 'primary' && pressTarget.kind === 'handle') {
    // Handles first: before Space and the Pan tool (today's order; fixture G3b).
  } else if (input.role === 'auxiliary') {
    // A plain middle drag pans; a middle tap does nothing.
    navigation = 'auxiliary-drag'
    pressed = false
  } else if (held.space) {
    navigation = 'space-drag'
    pressed = false
  } else if (context.tool === 'hand' && panIn('hand-tool')) {
    // The Pan tool: the drag pans, and the press and tap still reach the host.
    navigation = 'primary-drag'
  }

  // A primary or middle press is always default-prevented (no text selection, autoscroll or Linux paste) and captured.
  step.effects.push({ kind: 'prevent-default' }, { kind: 'capture', pointerId: input.id })
  putSession(step, {
    ...base,
    mode: navigation ? 'pan' : 'pending',
    captured: true,
    navigation,
    pressed,
  })
  if (pressed) step.gestures.push(pressOf(input, pressTarget))
  if (navigation) step.gestures.push({ kind: 'pan', phase: 'start', deltaPx: ZERO, source: navigation, at: input.at })
}

function move(step: Step, input: RawOf<'move'>, config: RecogniserConfig): void {
  const session = step.state.sessions.get(input.id)
  if (!session) {
    if (step.state.sessions.size > 0) return
    hover(step, input)
    return
  }

  // A button added or dropped mid-session changes nothing (the session keeps its mode until its up).
  if (session.mode === 'rotate') {
    rotateMove(step, session, input, config.platform)
    return
  }
  const slopPassed = session.slopPassed || passesSlop(session, input.at, config)
  if (session.mode === 'secondary') {
    if (Math.hypot(input.at.x - session.start.x, input.at.y - session.start.y) < NAVIGATION_SLOP_PX) return
    // Past the slop the pan starts at the press, and its first move carries the whole travel so far.
    putSession(step, { ...session, mode: 'pan', last: input.at, slopPassed: true })
    step.gestures.push(
      { kind: 'pan', phase: 'start', deltaPx: ZERO, source: 'secondary-drag', at: session.start },
      { kind: 'pan', phase: 'move', deltaPx: { x: input.at.x - session.start.x, y: input.at.y - session.start.y }, source: 'secondary-drag', at: input.at },
    )
    return
  }
  if (session.mode === 'pan') {
    const deltaPx = { x: input.at.x - session.last.x, y: input.at.y - session.last.y }
    putSession(step, { ...session, last: input.at, slopPassed })
    if ((deltaPx.x !== 0 || deltaPx.y !== 0) && session.navigation) {
      step.gestures.push({ kind: 'pan', phase: 'move', deltaPx, source: session.navigation, at: input.at })
    }
    return
  }
  if (session.mode === 'pending') {
    if (!slopPassed) return
    putSession(step, { ...session, mode: 'primary', last: input.at, slopPassed: true })
    step.gestures.push({ kind: 'drag-start', id: session.pointerId, at: input.at, mods: input.mods })
    return
  }
  if (session.mode === 'primary') {
    putSession(step, { ...session, last: input.at })
    step.gestures.push({ kind: 'drag-move', id: session.pointerId, at: input.at, mods: input.mods })
  }
}

function up(step: Step, input: RawOf<'up'>, config: RecogniserConfig): void {
  const session = step.state.sessions.get(input.id)
  if (!session) return
  dropSession(step, session)
  if (session.role === 'secondary' && !session.slopPassed) {
    // A still secondary click: the menu at the release point (convention), Shift or not; overview has none.
    if (step.state.context.mode !== 'overview') step.gestures.push({ kind: 'menu-request', at: input.at, source: 'mouse' })
    return
  }
  if (session.mode === 'rotate') {
    // A rotate that never passed its slop ends as it began: silently.
    if (session.slopPassed) step.gestures.push(rotateOf(session, 'end', session.last, stepsRotate(input.mods, config.platform)))
    return
  }
  if (session.mode === 'pan') {
    if (session.navigation) step.gestures.push(panEndOf(session))
    // A Pan-tool press the host saw ends once: a tap after a still click, or cancel('navigate') after its drag panned.
    if (session.pressed) step.gestures.push(session.slopPassed ? { kind: 'cancel', reason: 'navigate' } : tapOf(session, input))
    return
  }
  if (session.mode === 'pending') {
    step.gestures.push(tapOf(session, input))
    return
  }
  step.gestures.push({ kind: 'drag-end', id: session.pointerId, at: input.at, mods: input.mods })
}

function cancel(step: Step, input: RawOf<'cancel'>): void {
  if (input.id === 'all') {
    endLiveSessions(step, input.reason)
    releaseSpace(step)
    return
  }
  const session = step.state.sessions.get(input.id)
  if (!session) return
  if (input.reason === 'lost-capture') {
    // Only a capture the session holds can be lost; the browser already released it.
    if (!session.captured) return
    endSession(step, { ...session, captured: false }, 'lost-capture')
  } else {
    endSession(step, session, input.reason)
  }
  releaseSpace(step)
}

/** The host refused the press: the session ends with no gesture (its later moves are hovers). A session whose press the
 *  host never heard (a pan or rotate of its own) has nothing to refuse, so a live rotate always ends with its camera. */
function reject(step: Step, id: number): void {
  const session = step.state.sessions.get(id)
  if (!session?.pressed) return
  dropSession(step, session)
}

/**
 * The session sends one configure per setTool call, per overview change and per pointing-device change. Each ends the
 * live sessions ('tool-change') except one that, for the same tool, only leaves overview or only changes the pointing
 * device: today's setTool cancels the live gesture whatever the tool, so re-arming the armed tool is a fence too, and
 * entering overview cancels it and releases Space.
 */
function configure(step: Step, context: RawOf<'configure'>['context']): void {
  const previous = step.state.context
  const enteringOverview = context.mode === 'overview' && previous.mode !== 'overview'
  const leavingOverview = context.mode !== 'overview' && previous.mode === 'overview'
  const deviceChanged = context.pointingDevice !== previous.pointingDevice
  const settingOnly = context.tool === previous.tool && !enteringOverview && (leavingOverview || deviceChanged)
  if (!settingOnly) endLiveSessions(step, 'tool-change')
  if (enteringOverview) releaseSpace(step)
  step.state = {
    ...step.state,
    context: {
      tool: context.tool,
      mode: context.mode,
      pointingDevice: context.pointingDevice,
    },
  }
}

function wheel(step: Step, input: RawOf<'wheel'>): void {
  // The note editor, handles and the canvas's own chrome keep their wheels (not prevented).
  if (input.target.kind !== 'surface') return
  step.effects.push({ kind: 'prevent-default' })
  // A pointer rotate owns the camera from its press, so Esc restores exactly the camera it pressed on (fixture F18).
  if (pointerRotateLive(step.state)) return
  const { dxPx, dyPx, mods } = input
  if (!Number.isFinite(dxPx) || !Number.isFinite(dyPx)) return
  const scrollPans = step.state.context.pointingDevice === 'trackpad'
  // A pinch arrives as a Ctrl wheel: it, Ctrl and Cmd wheels zoom whatever the setting says, continuously by their delta (one
  // path, no notch detection: a 100 px notch is ×1.22).
  if (mods.ctrl || mods.meta || (!scrollPans && !mods.shift)) {
    const factor = Math.exp(Math.max(-1, Math.min(1, -dyPx * WHEEL_ZOOM_PER_PX)))
    if (factor !== 1) step.gestures.push({ kind: 'zoom', anchorPx: input.at, factor, source: 'wheel' })
    return
  }
  // A mouse wheel has one axis: under the Trackpad setting Shift turns its scroll sideways.
  const deltaPx = scrollPans && mods.shift && dxPx === 0 ? { x: -dyPx, y: 0 } : { x: -dxPx, y: -dyPx }
  if (deltaPx.x === 0 && deltaPx.y === 0) return
  step.gestures.push({ kind: 'pan', phase: 'move', deltaPx: withoutNegativeZero(deltaPx), source: 'wheel' })
}

/**
 * A move with no live session (buttons or not) is a hover wherever the source heard it: over the map, off it at the point a
 * hover left it (carried by the leave), or off it while the source still follows a pressed pointer whose session ended
 * (an Esc mid-press); off the map the host clears its own hover and the tool's still runs. Over the canvas's own things (owned chrome such as the attribution, the text entry,
 * a handle) it ends the hover and its tooltip (spec §2.2 "Hover", U6).
 */
function hover(step: Step, input: RawOf<'move'>): void {
  const { target } = input
  if (target.kind === 'owned-text' || target.kind === 'handle' || target.kind === 'owned-chrome') {
    step.gestures.push({ kind: 'hover-end' })
    return
  }
  step.gestures.push({ kind: 'hover', at: input.at, pointer: input.pointer, mods: input.mods, target })
}

/** −0 (a negated zero delta) reads as 0, so a pan's delta compares equal to the plain vector. */
function withoutNegativeZero(point: ScreenPoint): ScreenPoint {
  return { x: point.x === 0 ? 0 : point.x, y: point.y === 0 ? 0 : point.y }
}

function passesSlop(session: PointerSession, at: ScreenPoint, config: RecogniserConfig): boolean {
  const slop = config.bindings.dragSlopPx[session.pointer]
  const distance = Math.hypot(at.x - session.start.x, at.y - session.start.y)
  return distance >= slop && distance > 0
}

function pressOf(input: RawOf<'down'>, target: PressTarget): Gesture {
  return { kind: 'press', id: input.id, at: input.at, pointer: input.pointer, mods: input.mods, clickCount: input.detail, target }
}

/** A pointer pan's end, where the pointer last was: the router moves the host's resting pointer there. */
function panEndOf(session: PointerSession): Gesture {
  return { kind: 'pan', phase: 'end', deltaPx: ZERO, source: session.navigation!, at: session.last }
}

/**
 * A WebKit trackpad twist (gesturestart, gesturechange, gestureend; spec §2.2): only its rotation is used, since WKWebView
 * delivers the pinch as Ctrl wheels, which zoom as everywhere. It is a session under TRACKPAD_TWIST_ID, so Esc, blur and
 * configure end it like a pointer rotate: silent until the twist exceeds the threshold, then a rotate about the gesture's
 * point with the threshold subtracted, the ground following the fingers (WebKit's rotation is clockwise-positive; a
 * clockwise twist lowers the bearing). `trackpadTwistDeg` holds the rotation up to the change that crossed the threshold,
 * whose sign says which way the threshold is subtracted. One session at a time: a twist that starts during a pointer
 * session is ignored to its end, and a press during a twist is ignored (`down`). On iOS the pointers are the one source:
 * every gesture event is prevented and ignored. Every gesture event is prevented, so the page never zooms itself.
 */
function platformGesture(step: Step, input: RawOf<'platform-gesture'>, config: RecogniserConfig): void {
  step.effects.push({ kind: 'prevent-default' })
  if (config.platform.os === 'ios') return
  const live = step.state.sessions.get(TRACKPAD_TWIST_ID)
  if (input.phase === 'start') {
    // A start with a twist still live: its end was lost.
    if (live) endSession(step, live, 'pointercancel')
    if (step.state.sessions.size > 0) return
    putSession(step, {
      pointerId: TRACKPAD_TWIST_ID,
      // No button or pointer kind: the twist reads neither.
      pointer: 'mouse',
      role: 'auxiliary',
      mode: 'rotate',
      start: input.at,
      last: input.at,
      slopPassed: false,
      captured: false,
      navigation: 'trackpad-twist',
      pressed: false,
      clickCount: 0,
    })
    step.state = { ...step.state, trackpadTwistDeg: 0 }
    return
  }
  if (!live) return
  if (!live.slopPassed && input.phase === 'change') {
    step.state = { ...step.state, trackpadTwistDeg: input.rotationDeg }
    if (!(Math.abs(input.rotationDeg) > config.thresholds.trackpadTwistStartDeg)) return
    putSession(step, { ...live, slopPassed: true })
    step.gestures.push(twistOf(live, 'start', 0))
  }
  const subtractedDeg = Math.sign(step.state.trackpadTwistDeg) * config.thresholds.trackpadTwistStartDeg
  const totalDeltaDeg = subtractedDeg - input.rotationDeg
  if (input.phase === 'change') {
    step.gestures.push(twistOf(live, 'move', totalDeltaDeg))
    return
  }
  dropSession(step, live)
  if (live.slopPassed) step.gestures.push(twistOf(live, 'end', totalDeltaDeg))
}

function twistOf(session: PointerSession, phase: 'start' | 'move' | 'end', totalDeltaDeg: number): Gesture {
  return { kind: 'rotate', phase, anchorPx: session.start, totalDeltaDeg, step: false, source: 'trackpad-twist' }
}

/**
 * A pointer rotate's move: nothing within its slop; past it, `rotate{start}` about the press point, then the turn since
 * the press (rightward raises the bearing), stepped while mod is held.
 */
function rotateMove(step: Step, session: PointerSession, input: RawOf<'move'>, platform: InputPlatform): void {
  const starting = !session.slopPassed
  if (starting && Math.hypot(input.at.x - session.start.x, input.at.y - session.start.y) < NAVIGATION_SLOP_PX) return
  const live = { ...session, last: input.at, slopPassed: true }
  putSession(step, live)
  const stepped = stepsRotate(input.mods, platform)
  if (starting) step.gestures.push(rotateOf(live, 'start', live.start, stepped))
  step.gestures.push(rotateOf(live, 'move', input.at, stepped))
}

/** A key change during a live pointer rotate: the turn so far again, with the step the keys now give. */
function restepRotate(step: Step, mods: Modifiers, platform: InputPlatform): void {
  for (const session of step.state.sessions.values()) {
    if (session.mode !== 'rotate' || !session.slopPassed || session.navigation === 'trackpad-twist') continue
    step.gestures.push(rotateOf(session, 'move', session.last, stepsRotate(mods, platform)))
  }
}

function rotateOf(session: PointerSession, phase: 'start' | 'move' | 'end' | 'cancel', at: ScreenPoint, stepped: boolean): Gesture {
  return {
    kind: 'rotate',
    phase,
    anchorPx: session.start,
    totalDeltaDeg: phase === 'start' ? 0 : ROTATE_DEG_PER_PX * (at.x - session.start.x),
    step: stepped,
    source: session.navigation!,
  }
}

/** mod steps a rotate: Cmd where mod is Cmd (Ctrl never steps there), Ctrl elsewhere. */
function stepsRotate(mods: Modifiers, platform: InputPlatform): boolean {
  return modKeyIsCmd(platform) ? mods.meta : mods.ctrl
}

function pointerRotateLive(state: RecogniserState): boolean {
  for (const session of state.sessions.values()) {
    if (session.mode === 'rotate' && session.navigation !== 'trackpad-twist') return true
  }
  return false
}

function tapOf(session: PointerSession, input: RawOf<'up'>): Gesture {
  return {
    kind: 'tap',
    id: session.pointerId,
    at: input.at,
    pointer: session.pointer,
    mods: input.mods,
    clickCount: session.clickCount,
  }
}

/** Ends a session without completing it: a pan ends where it is, then the host hears the cancel. */
function endSession(step: Step, session: PointerSession, reason: CancelReason): void {
  dropSession(step, session)
  if (session.mode === 'pan' && session.navigation) step.gestures.push(panEndOf(session))
  // The router restores the camera the rotate started from; the input router does not cancel it on a plain cancel.
  if (session.mode === 'rotate' && session.slopPassed) step.gestures.push(rotateOf(session, 'cancel', session.last, false))
  step.gestures.push({ kind: 'cancel', reason })
}

function endLiveSessions(step: Step, reason: CancelReason): void {
  for (const session of [...step.state.sessions.values()]) endSession(step, session, reason)
}

function dropSession(step: Step, session: PointerSession): void {
  const sessions = new Map(step.state.sessions)
  sessions.delete(session.pointerId)
  step.state = { ...step.state, sessions }
  if (session.captured) step.effects.push({ kind: 'release-capture', pointerId: session.pointerId })
}

function putSession(step: Step, session: PointerSession): void {
  const sessions = new Map(step.state.sessions)
  sessions.set(session.pointerId, session)
  step.state = { ...step.state, sessions }
}

function releaseSpace(step: Step): void {
  if (!step.state.held.space) return
  step.state = { ...step.state, held: { space: false } }
}
