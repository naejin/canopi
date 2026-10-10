import { describe, expect, it } from 'vitest'
import type { ToolHandleId, ToolId } from '../interaction-types'
import type { Gesture } from './gestures'
import type { InputPlatform } from './platform'
import type { ButtonRole, RawInput, RecogniserConfig, RecogniserState, TargetClass } from './raw-input'
import { initialRecogniserState, recognise, type PointerSession } from './recognise'
import { DEFAULT_THRESHOLDS } from './thresholds'

const PLATFORM: InputPlatform = { os: 'linux', gestureEvents: false }
const CONFIG: RecogniserConfig = { platform: PLATFORM, thresholds: DEFAULT_THRESHOLDS }
const RUNS = 400
const STEPS = 60

/** mulberry32: a small seeded generator, so a failure names its seed and replays. */
function generator(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TARGETS: readonly TargetClass[] = [
  { kind: 'surface' },
  { kind: 'surface' },
  { kind: 'surface' },
  { kind: 'handle', id: 'rotate' as ToolHandleId },
  { kind: 'owned-chrome' },
  { kind: 'owned-text' },
  { kind: 'foreign' },
]
const TOOLS: readonly ToolId[] = ['select', 'hand', 'polygon', 'plant-spacing']
const ROLES: readonly ButtonRole[] = ['primary', 'primary', 'primary', 'auxiliary', 'secondary']
const POINTERS = ['mouse', 'pen', 'touch', 'touch'] as const

function randomInput(random: () => number, t: number): RawInput {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!
  const id = pick([1, 1, 1, 2])
  const at = { x: Math.round(random() * 400), y: Math.round(random() * 300) }
  const mods = { shift: random() < 0.2, ctrl: random() < 0.1, alt: false, meta: false }
  const roll = random()
  if (roll < 0.18) {
    return { kind: 'down', t, id, pointer: pick(['mouse', 'pen', 'touch', 'touch'] as const), role: pick(ROLES), at, mods, target: pick(TARGETS), detail: 1, ctrlConsumed: false }
  }
  if (roll < 0.45) {
    const buttonMask = ROLES.filter(() => random() < 0.3).reduce((mask, role) => mask | (role === 'primary' ? 1 : role === 'secondary' ? 2 : 4), 0)
    return { kind: 'move', t, id, pointer: pick(POINTERS), at, mods, target: pick(TARGETS), buttonMask }
  }
  if (roll < 0.58) return { kind: 'up', t, id, pointer: pick(POINTERS), role: pick(ROLES), at, mods, target: pick(TARGETS) }
  if (roll < 0.64) return { kind: 'cancel', t, id, reason: pick(['pointercancel', 'lost-capture'] as const) }
  if (roll < 0.68) return { kind: 'cancel', t, id: 'all', reason: 'blur' }
  if (roll < 0.74) return { kind: 'reject', t, id }
  if (roll < 0.78) return { kind: 'escape', t }
  if (roll < 0.84) {
    return { kind: 'configure', t, context: { tool: pick(TOOLS), mode: random() < 0.25 ? 'overview' : 'site', pointingDevice: pick(['mouse', 'trackpad'] as const) } }
  }
  if (roll < 0.92) return { kind: 'key-state', t, space: random() < 0.4, mods }
  if (roll < 0.93) return { kind: 'wheel', t, at, dxPx: random() * 20 - 10, dyPx: random() * 200 - 100, mods, target: pick(TARGETS) }
  if (roll < 0.96) {
    return { kind: 'platform-gesture', t, phase: pick(['start', 'change', 'change', 'end'] as const), at, rotationDeg: random() * 60 - 30 }
  }
  // The source's tick comes at the deadline it scheduled: a held press's long press is due 500 ms after its down.
  if (roll < 0.98) return { kind: 'tick', t: t + 600 }
  return { kind: 'leave', t }
}

const TERMINAL_EDITING = new Set(['tap', 'drag-end', 'cancel'])
/** The recogniser's session id for a trackpad twist (recognise.ts). */
const TRACKPAD_TWIST_ID = -1

function sessionPans(gestures: readonly Gesture[], phase: 'start' | 'end'): number {
  return gestures.filter((gesture) => gesture.kind === 'pan' && gesture.phase === phase && gesture.source !== 'wheel').length
}

function rotates(gestures: readonly Gesture[], phases: readonly string[]): number {
  return gestures.filter((gesture) => gesture.kind === 'rotate' && phases.includes(gesture.phase)).length
}

/** A rotate session's own end: its release, or a twist's gesture end. Anything else that ends one is a fence. */
function endsNaturally(input: RawInput): boolean {
  return input.kind === 'up' || (input.kind === 'platform-gesture' && input.phase === 'end')
}

/** A touch finger that does nothing more until it lifts: its gestures, if it had any, have ended. */
const spent = (session: PointerSession | undefined): boolean => session?.mode === 'spent'
/** A session that is not one of its own: a spent finger, or a pair's second finger (the pair is its first finger's). */
const husk = (session: PointerSession | undefined, state: RecogniserState): boolean =>
  spent(session) || (session?.mode === 'pair' && state.touchPair?.ids[1] === session.pointerId)

/**
 * Replays random interleavings and checks each step against the sessions before and after it. A session starts with a
 * press or a pan start, or silently as a pending rotate, a pending secondary press or a held touch press (which sends its
 * press when it passes its slop or lifts, A2); a finger that goes spent ends its session, and a spent finger's own lift
 * is nothing; it ends exactly once: an editing session with one tap, drag-end
 * or cancel; a pan with one pan end, then a cancel when a fence ended it; a rotate with one rotate end (its release) or
 * rotate cancel (a fence, then a cancel) once it passed its slop, and silently, or with a fence's cancel alone, before;
 * a reject ends it with no gesture. Every press the host sees ends once: a Pan-tool press with a tap after a still click,
 * or with cancel('navigate') after its drag panned (fixture J1). A rotate starts once, when its session passes its slop.
 */
function checkSessionLifecycle(seed: number): void {
  const random = generator(seed)
  let state: RecogniserState = initialRecogniserState()
  let started = 0
  let ended = 0
  let rotateStarts = 0
  let rotateEnds = 0
  const at = (index: number) => `seed ${seed}, step ${index}`

  const feed = (input: RawInput, index: number): void => {
    const before = state.sessions
    const snapshot = structuredClone(state)
    const result = recognise(state, input, CONFIG)
    expect(state, `${at(index)}: recognise mutated its input`).toEqual(snapshot)
    state = result.state
    const after = state.sessions
    // One session at a time, or two fingers.
    const fingers = [...after.values()].every((session) => session.pointer === 'touch' && session.pointerId !== TRACKPAD_TWIST_ID)
    expect(after.size, at(index)).toBeLessThanOrEqual(fingers ? 2 : 1)

    const endedSessions: PointerSession[] = []
    // A down on a live pointer id, or a gesture start with a twist live, ends that session and may start the next.
    const restarts = (id: number) => (input.kind === 'down' && input.id === id)
      || (input.kind === 'platform-gesture' && input.phase === 'start' && id === TRACKPAD_TWIST_ID)
    // A finger that starts the pair (held, dragging or panning) ends its own session; the pair is a new one.
    const joinsPair = (id: number) => after.get(id)?.mode === 'pair' && before.get(id)?.mode !== 'pair'
    for (const [id, session] of before) {
      if (husk(session, snapshot)) continue
      if (!after.has(id) || (restarts(id) && after.get(id) !== session) || husk(after.get(id), state) || joinsPair(id)) {
        endedSessions.push(session)
      }
    }
    const gestures = result.gestures
    const editingEnds = gestures.filter((gesture) => TERMINAL_EDITING.has(gesture.kind)).length
    const panEnds = sessionPans(gestures, 'end')
    const rotateEndsNow = rotates(gestures, ['end', 'cancel'])
    const rotateStartsNow = rotates(gestures, ['start'])
    const starts = gestures.filter((gesture) => gesture.kind === 'press').length + sessionPans(gestures, 'start')
    // A held touch press lifted within its slop: its press and its tap come together (A2).
    const heldTap = input.kind === 'up' && endedSessions[0]?.mode === 'held' && endedSessions[0].heldPress !== null

    expect(endedSessions.length, at(index)).toBeLessThanOrEqual(1)
    const [endedSession] = endedSessions
    if (!endedSession) {
      expect({ editingEnds, panEnds, rotateEndsNow }, `${at(index)}: a terminal gesture without an ending session`)
        .toEqual({ editingEnds: 0, panEnds: 0, rotateEndsNow: 0 })
    } else if (input.kind === 'reject') {
      expect(gestures, `${at(index)}: a reject emits nothing`).toEqual([])
    } else if (endedSession.mode === 'pair') {
      // A pair ends in place: its pan ends, a live twist ends (never cancels), and a fence sends the host a cancel (A6).
      expect({ editingEnds, panEnds, rotateEndsNow }, `${at(index)}: a pair ends once`).toEqual({
        editingEnds: input.kind === 'up' ? 0 : 1,
        panEnds: 1,
        rotateEndsNow: snapshot.touchPair?.twistDeg !== null ? 1 : 0,
      })
      expect(rotates(gestures, ['cancel']), `${at(index)}: a pair's turn never cancels`).toBe(0)
    } else if (endedSession.mode === 'held') {
      // The host heard nothing of a held press: it ends silently, unless its lift sends the press and its tap.
      expect({ editingEnds, panEnds, rotateEndsNow }, `${at(index)}: a held touch press ends once`)
        .toEqual({ editingEnds: heldTap ? 1 : 0, panEnds: 0, rotateEndsNow: 0 })
    } else if (endedSession.mode === 'secondary') {
      // A still secondary press ends with its menu on release, or with a fence's cancel.
      const fenced = !endsNaturally(input)
      expect({ editingEnds, panEnds, rotateEndsNow }, `${at(index)}: a secondary press ends once`).toEqual({
        editingEnds: fenced ? 1 : 0,
        panEnds: 0,
        rotateEndsNow: 0,
      })
    } else if (endedSession.mode === 'rotate') {
      const fenced = !endsNaturally(input)
      expect({ editingEnds, panEnds, rotateEndsNow }, `${at(index)}: a rotate session ends once`).toEqual({
        editingEnds: fenced ? 1 : 0,
        panEnds: 0,
        rotateEndsNow: endedSession.slopPassed ? 1 : 0,
      })
    } else if (endedSession.mode === 'pan') {
      expect(panEnds, at(index)).toBe(1)
      expect(rotateEndsNow, at(index)).toBe(0)
      // A press the host saw ends once, whatever ended its pan; a pan with no press ends silently on its release.
      expect(editingEnds, at(index)).toBe(endedSession.pressed || input.kind !== 'up' ? 1 : 0)
      if (endedSession.pressed && input.kind === 'up') {
        const navigated = gestures.some((gesture) => gesture.kind === 'cancel' && gesture.reason === 'navigate')
        expect(navigated, `${at(index)}: a Pan-tool press ends with a tap only when its drag did not pan`).toBe(endedSession.slopPassed)
      }
    } else {
      expect({ editingEnds, panEnds, rotateEndsNow }, at(index)).toEqual({ editingEnds: 1, panEnds: 0, rotateEndsNow: 0 })
    }
    const startedNow = [...after.keys()].filter((id) => !husk(after.get(id), state)
      && (!before.has(id) || (restarts(id) && after.get(id) !== before.get(id)) || joinsPair(id)))
    const pending = (id: number) => ['rotate', 'secondary', 'held'].includes(after.get(id)!.mode)
    const silentStart = startedNow.length > 0 && startedNow.every(pending)
    // A still secondary press becomes a pan once it passes its slop, and a held touch press a drag or a pan: its press or
    // its pan starts then, on a move.
    const resolvedNow = [...after.values()].filter((session) => (session.mode === 'pan' || session.mode === 'primary')
      && ['secondary', 'held'].includes(before.get(session.pointerId)?.mode ?? '')).length
    if (silentStart) expect(starts, `${at(index)}: a pending rotate, secondary or touch press starts silently`).toBe(0)
    else if (startedNow.length > 0) expect(starts, `${at(index)}: a session started silently`).toBeGreaterThan(0)
    else expect(starts, `${at(index)}: a start gesture without a new session`).toBe(resolvedNow + (heldTap ? 1 : 0))
    const menus = gestures.filter((gesture) => gesture.kind === 'menu-request').length
    const stillSecondaryUp = input.kind === 'up' && endedSession?.role === 'secondary' && !endedSession.slopPassed
    const longPress = input.kind === 'tick' && endedSession?.mode === 'held'
    expect(menus, `${at(index)}: a menu only from a still secondary release or a long press`)
      .toBeLessThanOrEqual(stillSecondaryUp || longPress ? 1 : 0)
    started += startedNow.length
    ended += endedSessions.length

    const lives = [...after.values()]
    const live = lives.find((session) => !spent(session))
    const twistsNow = state.touchPair !== null && state.touchPair.twistDeg !== null
      && snapshot.touchPair !== null && snapshot.touchPair.twistDeg === null
    const passedSlopNow = (live?.mode === 'rotate' && live.slopPassed && !(before.get(live.pointerId)?.slopPassed ?? false)) || twistsNow
    expect(rotateStartsNow, `${at(index)}: a rotate starts when its session passes its slop`).toBe(passedSlopNow ? 1 : 0)
    rotateStarts += rotateStartsNow
    rotateEnds += rotateEndsNow
    for (const gesture of gestures) {
      if (gesture.kind === 'drag-start' || gesture.kind === 'drag-move') {
        expect(after.get(gesture.id)?.mode, `${at(index)}: ${gesture.kind} outside a primary drag`).toBe('primary')
      }
      if (gesture.kind === 'pan' && gesture.phase === 'move' && gesture.source !== 'wheel') {
        expect(live?.mode, `${at(index)}: a pan move outside a pan`).toBe(gesture.source === 'touch-two-finger' ? 'pair' : 'pan')
      }
      const pairTwists = state.touchPair !== null && state.touchPair.twistDeg !== null
      if (gesture.kind === 'rotate' && gesture.phase === 'move' && !(live?.mode === 'rotate' && live.slopPassed) && !pairTwists) {
        expect.fail(`${at(index)}: a rotate move outside a live rotate`)
      }
      if (gesture.kind === 'zoom' && live?.mode === 'rotate' && live.navigation !== 'trackpad-twist') {
        expect.fail(`${at(index)}: a zoom during a pointer rotate`)
      }
    }
  }

  for (let index = 0; index < STEPS; index += 1) feed(randomInput(random, index * 16), index)
  feed({ kind: 'cancel', t: STEPS * 16, id: 'all', reason: 'blur' }, STEPS)
  expect(state.sessions.size, `seed ${seed}: sessions outlived the final blur`).toBe(0)
  expect(ended, `seed ${seed}`).toBe(started)
  expect(rotateEnds, `seed ${seed}: every rotate that started ends once`).toBe(rotateStarts)
}

/** Every capture effect is released by a release-capture, or by the browser (a lost capture the recogniser acted on). */
function checkCaptureLedger(seed: number): void {
  const random = generator(seed)
  let state: RecogniserState = initialRecogniserState()
  const held = new Set<number>()
  const feed = (input: RawInput, index: number): void => {
    const result = recognise(state, input, CONFIG)
    const id = 'id' in input && typeof input.id === 'number' ? input.id : null
    const hadCapture = id !== null && (state.sessions.get(id)?.captured ?? false)
    state = result.state
    if (input.kind === 'cancel' && input.reason === 'lost-capture' && id !== null && hadCapture) held.delete(id)
    for (const effect of result.effects) {
      if (effect.kind === 'capture') {
        expect(held.has(effect.pointerId!), `seed ${seed}, step ${index}: captured twice`).toBe(false)
        held.add(effect.pointerId!)
      }
      if (effect.kind === 'release-capture') {
        expect(held.has(effect.pointerId!), `seed ${seed}, step ${index}: released a capture it never took`).toBe(true)
        held.delete(effect.pointerId!)
      }
    }
    for (const session of state.sessions.values()) {
      if (session.captured) expect(held.has(session.pointerId), `seed ${seed}, step ${index}`).toBe(true)
    }
  }
  for (let index = 0; index < STEPS; index += 1) feed(randomInput(random, index * 16), index)
  feed({ kind: 'cancel', t: STEPS * 16, id: 'all', reason: 'blur' }, STEPS)
  expect([...held], `seed ${seed}: captures never released`).toEqual([])
}

/** 400 seeds take about 2 s alone and over 5 s on a loaded machine, past vitest's default timeout. */
const PROPERTY_TIMEOUT_MS = 30_000

describe('recognise properties', () => {
  it('every started session ends exactly once', { timeout: PROPERTY_TIMEOUT_MS }, () => {
    for (let seed = 1; seed <= RUNS; seed += 1) checkSessionLifecycle(seed)
  })

  it('every capture is released', () => {
    for (let seed = 1; seed <= RUNS; seed += 1) checkCaptureLedger(seed)
  })
})
