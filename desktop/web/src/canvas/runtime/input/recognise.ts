// canvas/runtime/input/recognise.ts  (the recogniser: its three state types and its two functions)
//
// Owns gesture recognition: a pure reducer from one RawInput to gestures and the effects the DOM source applies to the
// event it is handling. No clock, timer or DOM: time is `RawInput.t`, the platform and bindings come in the config.
// PointerSession, NestedNavigation and TouchPair are type exports imported only inside input/; RecogniserState is opaque
// to callers. raw-input.ts and recognise.ts import each other's types with `import type` only (no runtime cycle).
//
// It implements today's input (LEGACY_BINDINGS, spec §2.2 and the LEGACY columns of §5): one pointer session at a time;
// the right button inert and the native contextmenu opening the menu at once (except in overview and for a keyboard
// menu's echo); a middle drag, a Space press, overview and the Pan tool pan (a primary press on a handle drags the handle
// first), a pointer pan carrying the pointer's point and a Pan-tool press ending with cancel('navigate') after its drag;
// a button-less move over the text entry, a handle or the Unlock affordance emits nothing; wheels zoom or pan by the
// pointing-device setting; no touch gestures, pen barrel or trackpad gesture events.
// The other binding values arrive with their constants: the trackpad gestures and Shift+middle rotation in phase 1, the
// secondary drag, the nested sub-session and the menu on release in phase 2, touch gestures and the long press in phase 3.

import type { CancelReason, Modifiers, PointerKind } from '../interaction-types'
import type { ScreenPoint } from '../view/types'
import type { Gesture, NavigationSource, PressTarget } from './gestures'
import type { AdapterEffect, ButtonRole, RawInput, RecogniserConfig, RecogniserState, TargetClass } from './raw-input'

export interface PointerSession {
  readonly pointerId: number
  readonly pointer: PointerKind
  readonly role: ButtonRole
  /** 'pending' is a primary press within slop; 'primary' a primary drag past it; 'pan' a navigation pan. */
  readonly mode: 'pending' | 'primary' | 'pan' | 'rotate' | 'ignored'
  readonly start: ScreenPoint
  readonly last: ScreenPoint
  readonly target: TargetClass
  readonly slopPassed: boolean
  readonly captured: boolean
  /** The press target its editing gestures carry. */
  readonly pressTarget: PressTarget
  /** The pan's source while `mode` is 'pan'. */
  readonly navigation: NavigationSource | null
  /** True when a `press` reached the host, which owes it one end: a `tap` within slop, else `cancel('navigate')` for a pan
   *  (the Pan tool's press). */
  readonly pressed: boolean
  /** The platform's pointerdown `detail`, as delivered (never counted here under LEGACY). */
  readonly clickCount: number
}

export interface NestedNavigation {
  readonly pointerId: number
  readonly role: ButtonRole
  readonly mode: 'pending' | 'pan' | 'rotate'
  readonly start: ScreenPoint
  readonly last: ScreenPoint
  readonly frozenPrimary: ScreenPoint
}

export interface TouchPair {
  readonly ids: readonly [number, number]
  readonly startCentroid: ScreenPoint
  readonly startDistancePx: number
  readonly startAngleDeg: number
  readonly twistDeg: number
}

const NO_MODIFIERS: Modifiers = Object.freeze({ shift: false, ctrl: false, alt: false, meta: false })
const ZERO: ScreenPoint = Object.freeze({ x: 0, y: 0 })
/** Wheel zoom: today's exp(clamp(−dy × 0.002, ±1)) per event. */
const WHEEL_ZOOM_PER_PX = 0.002

export function initialRecogniserState(): RecogniserState {
  return {
    sessions: new Map(),
    nested: null,
    touchPair: null,
    held: { space: false, mods: NO_MODIFIERS },
    trackpadTwistDeg: 0,
    deadlines: { longPressAt: null, menuEchoUntil: null, windowsTrailUntil: null, lastSecondaryEndAt: null },
    context: { tool: 'select', mode: 'site', pointingDevice: 'mouse', dragSlopPx: null },
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
    case 'up': up(step, input); break
    case 'cancel': cancel(step, input); break
    case 'reject': reject(step, input.id); break
    case 'leave': step.gestures.push({ kind: 'hover-end' }); break
    case 'escape':
      endLiveSessions(step, 'escape')
      releaseSpace(step)
      break
    case 'key-state':
      step.state = { ...step.state, held: { space: input.space, mods: input.mods } }
      break
    case 'configure': configure(step, input.context); break
    case 'wheel': wheel(step, input); break
    case 'native-contextmenu': nativeContextMenu(step, input); break
    case 'drop':
      // Dragover and drop are always default-prevented (the drop target); dragleave is only observed.
      if (input.phase !== 'leave') step.effects.push({ kind: 'prevent-default' })
      step.gestures.push({ kind: 'drop', phase: input.phase, at: input.at, payload: input.payload })
      break
    case 'platform-gesture':
      // LEGACY: no gesture* listener today (trackpadGestures false); WebKit's Ctrl wheels zoom instead. Phase 1 adds them.
      break
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
  // Secondary under 'menu-on-native': the button is inert; the native contextmenu opens the menu (phase 2 adds the drag).
  if (input.role === 'secondary') return
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
    target: input.target,
    slopPassed: false,
    clickCount: input.detail,
  } as const

  if (input.target.kind === 'ruler') {
    // Today's ruler drag (normalise makes any mouse button primary there): no capture, the drag follows the pointer anywhere.
    step.effects.push({ kind: 'prevent-default' })
    const pressTarget: PressTarget = { kind: 'ruler', axis: input.target.axis }
    putSession(step, { ...base, mode: 'pending', captured: false, pressTarget, navigation: null, pressed: true })
    step.gestures.push(pressOf(input, pressTarget))
    return
  }

  const pressTarget: PressTarget = input.target.kind === 'handle' ? { kind: 'handle', id: input.target.id } : { kind: 'surface' }
  const panIn = (panContext: 'hand-tool' | 'overview'): boolean => bindings.primaryDragPansIn.includes(panContext)

  let navigation: NavigationSource | null = null
  let pressed = true
  if (context.mode === 'overview' && (input.role === 'auxiliary' || panIn('overview'))) {
    // Legacy overview: a left or middle press pans the map, whatever is under it; a pan never reaches the host.
    navigation = input.role === 'auxiliary' ? 'auxiliary-drag' : 'primary-drag'
    pressed = false
  } else if (input.role === 'primary' && pressTarget.kind === 'handle') {
    // Handles first: before Space and the Pan tool (today's order; fixture G3b).
  } else if (input.role === 'auxiliary') {
    // Plain and (LEGACY) Shift middle drags pan; a middle tap does nothing.
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
    pressTarget,
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
    hover(step, input, config)
    return
  }

  // LEGACY: a button added or dropped mid-session changes nothing (the session keeps its mode until its up).
  const slopPassed = session.slopPassed || passesSlop(session, input.at, step.state, config)
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
    step.gestures.push({
      kind: 'drag-start',
      id: session.pointerId,
      from: session.start,
      at: input.at,
      pointer: session.pointer,
      mods: input.mods,
      target: session.pressTarget,
    })
    return
  }
  if (session.mode === 'primary') {
    putSession(step, { ...session, last: input.at })
    step.gestures.push({ kind: 'drag-move', id: session.pointerId, at: input.at, mods: input.mods })
  }
}

function up(step: Step, input: RawOf<'up'>): void {
  const session = step.state.sessions.get(input.id)
  if (!session) return
  dropSession(step, session)
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

/** The host refused the press: the session ends with no gesture (its later moves are hovers). */
function reject(step: Step, id: number): void {
  const session = step.state.sessions.get(id)
  if (!session) return
  dropSession(step, session)
}

/**
 * The session sends one configure per setTool call, per overview change and per pointing-device change. Each ends the
 * live sessions ('tool-change') except one that, for the same tool, only leaves overview or only changes the pointing
 * device: today's setTool cancels the live gesture whatever the tool, so re-arming the armed tool is a fence too, and
 * entering overview cancels it and releases Space (today's setOverviewMode).
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
      dragSlopPx: context.dragSlopPx ?? null,
    },
  }
}

function wheel(step: Step, input: RawOf<'wheel'>): void {
  // The note editor, handles and the canvas's own chrome keep their wheels (not prevented).
  if (input.target.kind !== 'surface') return
  step.effects.push({ kind: 'prevent-default' })
  const { dxPx, dyPx, mods } = input
  if (!Number.isFinite(dxPx) || !Number.isFinite(dyPx)) return
  const scrollPans = step.state.context.pointingDevice === 'trackpad'
  // A pinch arrives as a Ctrl wheel and zooms whatever the setting says; so do Ctrl and Cmd wheels.
  if (input.pinch || mods.ctrl || mods.meta || (!scrollPans && !mods.shift)) {
    const factor = Math.exp(Math.max(-1, Math.min(1, -dyPx * WHEEL_ZOOM_PER_PX)))
    if (factor !== 1) {
      step.gestures.push({ kind: 'zoom', anchorPx: input.at, factor, source: input.pinch ? 'trackpad-pinch' : 'wheel' })
    }
    return
  }
  // A mouse wheel has one axis: under the Trackpad setting Shift turns its scroll sideways.
  const deltaPx = scrollPans && mods.shift && dxPx === 0 ? { x: -dyPx, y: 0 } : { x: -dxPx, y: -dyPx }
  if (deltaPx.x === 0 && deltaPx.y === 0) return
  step.gestures.push({ kind: 'pan', phase: 'move', deltaPx: withoutNegativeZero(deltaPx), source: 'wheel' })
}

/**
 * A move with no live session (buttons or not) is a hover wherever the pointer is: off the map the tool's hover still
 * runs and the host clears its own. Over the canvas's own things the bindings decide (spec §2.2 "Hover"): under 'legacy'
 * the text entry and a handle emit nothing (today's early return keeps the passive hover, the tooltip, the Unlock
 * affordance and the Place plants preview) while the map's other buttons and fields hover what is beneath them; under
 * 'end' all three end the hover. The Unlock affordance keeps the hover under both.
 */
function hover(step: Step, input: RawOf<'move'>, config: RecogniserConfig): void {
  const { target } = input
  if (target.kind === 'owned-chrome' && target.lockedAffordance) return
  const owned = target.kind === 'owned-text' || target.kind === 'handle'
  if (config.bindings.ownedHover === 'end' && (owned || target.kind === 'owned-chrome')) {
    step.gestures.push({ kind: 'hover-end' })
    return
  }
  if (owned) return
  step.gestures.push({ kind: 'hover', at: input.at, pointer: input.pointer, mods: input.mods, target })
}

function nativeContextMenu(step: Step, input: RawOf<'native-contextmenu'>): void {
  // The note editor and anything outside the map keep the native menu (copy and paste).
  if (input.target.kind === 'owned-text' || input.target.kind === 'foreign' || input.target.kind === 'ruler') return
  step.effects.push({ kind: 'prevent-default' })
  if (step.state.context.mode === 'overview') return
  // The Menu key already opened the menu from keydown; its trailing event is the echo.
  if (input.fromKeyboard || input.at === null) return
  // Even during a primary session (today: the menu opens unless a Scene Edit is live, which the host decides).
  step.gestures.push({ kind: 'menu-request', at: input.at, source: 'native' })
}

/** −0 (a negated zero delta) reads as 0, so a pan's delta compares equal to the plain vector. */
function withoutNegativeZero(point: ScreenPoint): ScreenPoint {
  return { x: point.x === 0 ? 0 : point.x, y: point.y === 0 ? 0 : point.y }
}

function passesSlop(session: PointerSession, at: ScreenPoint, state: RecogniserState, config: RecogniserConfig): boolean {
  const slop = state.context.dragSlopPx ?? config.bindings.dragSlopPx[session.pointer]
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

function tapOf(session: PointerSession, input: RawOf<'up'>): Gesture {
  return {
    kind: 'tap',
    id: session.pointerId,
    at: input.at,
    pointer: session.pointer,
    mods: input.mods,
    clickCount: session.clickCount,
    target: session.pressTarget,
  }
}

/** Ends a session without completing it: a pan ends where it is, then the host hears the cancel. */
function endSession(step: Step, session: PointerSession, reason: CancelReason): void {
  dropSession(step, session)
  if (session.mode === 'pan' && session.navigation) step.gestures.push(panEndOf(session))
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
  step.state = { ...step.state, held: { ...step.state.held, space: false } }
}
