import { describe, expect, it } from 'vitest'
import type { ToolHandleId, ToolId } from '../interaction-types'
import { LEGACY_BINDINGS } from './bindings'
import type { Gesture } from './gestures'
import type { InputPlatform } from './platform'
import type { ButtonRole, RawInput, RecogniserConfig, RecogniserState, TargetClass } from './raw-input'
import { initialRecogniserState, recognise, type PointerSession } from './recognise'
import { DEFAULT_THRESHOLDS } from './thresholds'

const PLATFORM: InputPlatform = { os: 'linux', engine: 'webkitgtk', gestureEvents: false }
const CONFIG: RecogniserConfig = { platform: PLATFORM, bindings: LEGACY_BINDINGS, thresholds: DEFAULT_THRESHOLDS }
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
  { kind: 'ruler', axis: 'v' },
  { kind: 'owned-chrome' },
  { kind: 'owned-chrome', lockedAffordance: true },
  { kind: 'owned-text' },
  { kind: 'foreign' },
]
const TOOLS: readonly ToolId[] = ['select', 'hand', 'polygon', 'plant-spacing']
const ROLES: readonly ButtonRole[] = ['primary', 'primary', 'primary', 'auxiliary', 'secondary']

function randomInput(random: () => number, t: number): RawInput {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!
  const id = pick([1, 1, 1, 2])
  const at = { x: Math.round(random() * 400), y: Math.round(random() * 300) }
  const mods = { shift: random() < 0.2, ctrl: random() < 0.1, alt: false, meta: false }
  const roll = random()
  if (roll < 0.18) {
    return { kind: 'down', t, id, pointer: pick(['mouse', 'mouse', 'pen', 'touch'] as const), role: pick(ROLES), at, mods, target: pick(TARGETS), detail: 1, ctrlConsumed: false }
  }
  if (roll < 0.45) {
    const buttons = new Set<ButtonRole>(ROLES.filter(() => random() < 0.3))
    const buttonMask = (buttons.has('primary') ? 1 : 0) | (buttons.has('secondary') ? 2 : 0) | (buttons.has('auxiliary') ? 4 : 0)
    return { kind: 'move', t, id, pointer: 'mouse', at, mods, buttons, target: pick(TARGETS), buttonMask }
  }
  if (roll < 0.58) return { kind: 'up', t, id, pointer: 'mouse', role: pick(ROLES), at, mods }
  if (roll < 0.64) return { kind: 'cancel', t, id, reason: pick(['pointercancel', 'lost-capture'] as const) }
  if (roll < 0.68) return { kind: 'cancel', t, id: 'all', reason: 'blur' }
  if (roll < 0.74) return { kind: 'reject', t, id }
  if (roll < 0.78) return { kind: 'escape', t }
  if (roll < 0.84) {
    return { kind: 'configure', t, context: { tool: pick(TOOLS), mode: random() < 0.25 ? 'overview' : 'site', pointingDevice: pick(['mouse', 'trackpad'] as const) } }
  }
  if (roll < 0.92) return { kind: 'key-state', t, space: random() < 0.4, mods }
  if (roll < 0.96) return { kind: 'wheel', t, at, dxPx: random() * 20 - 10, dyPx: random() * 200 - 100, mods, pinch: false, target: pick(TARGETS) }
  return { kind: 'native-contextmenu', t, at, fromKeyboard: random() < 0.3, target: pick(TARGETS) }
}

const TERMINAL_EDITING = new Set(['tap', 'drag-end', 'cancel'])

function sessionPans(gestures: readonly Gesture[], phase: 'start' | 'end'): number {
  return gestures.filter((gesture) => gesture.kind === 'pan' && gesture.phase === phase && gesture.source !== 'wheel').length
}

/**
 * Replays random interleavings and checks each step against the sessions before and after it. A session starts with a
 * press or a pan start, and ends exactly once: an editing session with one tap, drag-end or cancel; a pan with one pan
 * end, then a cancel when a fence ended it; a reject ends it with no gesture. Every press the host sees ends once: a
 * Pan-tool press with a tap after a still click, or with cancel('navigate') after its drag panned (fixture J1).
 */
function checkSessionLifecycle(seed: number): void {
  const random = generator(seed)
  let state: RecogniserState = initialRecogniserState()
  let started = 0
  let ended = 0
  const at = (index: number) => `seed ${seed}, step ${index}`

  const feed = (input: RawInput, index: number): void => {
    const before = state.sessions
    const snapshot = structuredClone(state)
    const result = recognise(state, input, CONFIG)
    expect(state, `${at(index)}: recognise mutated its input`).toEqual(snapshot)
    state = result.state
    const after = state.sessions
    expect(after.size, at(index)).toBeLessThanOrEqual(1)

    const endedSessions: PointerSession[] = []
    for (const [id, session] of before) {
      if (!after.has(id) || (input.kind === 'down' && input.id === id && after.get(id) !== session)) endedSessions.push(session)
    }
    const gestures = result.gestures
    const editingEnds = gestures.filter((gesture) => TERMINAL_EDITING.has(gesture.kind)).length
    const panEnds = sessionPans(gestures, 'end')
    const starts = gestures.filter((gesture) => gesture.kind === 'press').length + sessionPans(gestures, 'start')

    expect(endedSessions.length, at(index)).toBeLessThanOrEqual(1)
    const [endedSession] = endedSessions
    if (!endedSession) {
      expect({ editingEnds, panEnds }, `${at(index)}: a terminal gesture without an ending session`).toEqual({ editingEnds: 0, panEnds: 0 })
    } else if (input.kind === 'reject') {
      expect(gestures, `${at(index)}: a reject emits nothing`).toEqual([])
    } else if (endedSession.mode === 'pan') {
      expect(panEnds, at(index)).toBe(1)
      // A press the host saw ends once, whatever ended its pan; a pan with no press ends silently on its release.
      expect(editingEnds, at(index)).toBe(endedSession.pressed || input.kind !== 'up' ? 1 : 0)
      if (endedSession.pressed && input.kind === 'up') {
        const navigated = gestures.some((gesture) => gesture.kind === 'cancel' && gesture.reason === 'navigate')
        expect(navigated, `${at(index)}: a Pan-tool press ends with a tap only when its drag did not pan`).toBe(endedSession.slopPassed)
      }
    } else {
      expect({ editingEnds, panEnds }, at(index)).toEqual({ editingEnds: 1, panEnds: 0 })
    }
    const startedNow = [...after.keys()].filter((id) => !before.has(id) || endedSessions.some((session) => session.pointerId === id))
    if (startedNow.length > 0) expect(starts, `${at(index)}: a session started silently`).toBeGreaterThan(0)
    else expect(starts, `${at(index)}: a start gesture without a new session`).toBe(0)
    started += startedNow.length
    ended += endedSessions.length

    const live = [...after.values()][0]
    for (const gesture of gestures) {
      if (gesture.kind === 'drag-start' || gesture.kind === 'drag-move') {
        expect(live?.mode, `${at(index)}: ${gesture.kind} outside a primary drag`).toBe('primary')
      }
      if (gesture.kind === 'pan' && gesture.phase === 'move' && gesture.source !== 'wheel') {
        expect(live?.mode, `${at(index)}: a pan move outside a pan`).toBe('pan')
      }
    }
  }

  for (let index = 0; index < STEPS; index += 1) feed(randomInput(random, index * 16), index)
  feed({ kind: 'cancel', t: STEPS * 16, id: 'all', reason: 'blur' }, STEPS)
  expect(state.sessions.size, `seed ${seed}: sessions outlived the final blur`).toBe(0)
  expect(ended, `seed ${seed}`).toBe(started)
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

describe('recognise properties under LEGACY_BINDINGS', () => {
  it('every started session ends exactly once', () => {
    for (let seed = 1; seed <= RUNS; seed += 1) checkSessionLifecycle(seed)
  })

  it('every capture is released', () => {
    for (let seed = 1; seed <= RUNS; seed += 1) checkCaptureLedger(seed)
  })
})
