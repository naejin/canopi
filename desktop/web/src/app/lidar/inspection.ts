import { computed, effect, signal } from '@preact/signals'
import type { LidarSampleOutcome } from '../../generated/contracts'
import { lidarCancelSamplePixel, lidarSamplePixel } from '../../ipc/lidar'
import { currentDesign, designSessionStore } from '../document-session/store'
import { activePanel } from '../shell/state'
import { readLidarPresentation, lidarLibrary } from './library-store'
import {
  inspectionPointForScenePoint,
  inspectionViewCentreScenePoint,
} from './camera-request'

/**
 * What one inspection lookup is currently showing.
 *
 * `stale` is deliberately distinct from `unavailable`: a stale answer means the
 * head moved under the user and re-aiming will work, while an unavailable one
 * needs a different response. Neither is ever presented as a current value.
 */
export type InspectionSample =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'value'; readonly value: number; readonly units: string }
  | { readonly kind: 'no-data' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'unavailable'; readonly reason: string }

/** One inspected entity, or none. */
export interface InspectionTarget {
  readonly kind: 'Source' | 'Analysis'
  readonly id: string
  readonly name: string
}

/** One WGS84 point to sample, as the canvas itself projected it. */
export interface InspectionPoint {
  readonly lat: number
  readonly lon: number
}

/** The layer inspection is aimed at, or null when inspection is off. */
const inspectionSession = signal<InspectionTarget | null>(null)

/**
 * The layer inspection is aimed at, or null when inspection is off.
 *
 * Derived rather than stored so a Design replacement drops the session in the
 * same read that would otherwise return a target from a document that no longer
 * exists: the session names the Design it was entered for, and a different
 * Design is a different document with different presentation.
 */
export const inspectionTarget = computed<InspectionTarget | null>(() => {
  if (!inspectionSession.value) return null
  if (session && session.designIdentity !== currentDesignIdentity()) return null
  return inspectionSession.value
})

/** The result of the most recent lookup for the current target. */
export const inspectionSample = signal<InspectionSample>({ kind: 'idle' })

/** Where the last sample was taken, for the read-only status surface. */
export const inspectionLocation = signal<InspectionPoint | null>(null)

/**
 * The identity of one inspection session.
 *
 * Every aim, every sample and every exit advances the request counter. A
 * response may only publish when its own session is still the live one *and*
 * the Design, entity and head it was aimed at are still current, so a slow
 * answer can never be shown as the result for a layer, head or Design the user
 * has already left.
 */
interface InspectionSession {
  /** Monotonic request identity, advanced by every aim, sample and exit. */
  readonly request: number
  /**
   * The opaque id the in-flight lookup was submitted under, or null.
   *
   * Kept so the next aim or the exit can cancel exactly that lookup: the native
   * side admits it into the shared bounded read queue, and nothing else may
   * release the slot it holds.
   */
  readonly pendingRequestId: string | null
  /**
   * The document session this was entered for, so a replacement ends it.
   *
   * The frozen session identity is the document layer's own "a different Design
   * is loaded now" token; ordinary edits keep it, so an edit does not end
   * inspection while loading another Design does.
   */
  readonly designIdentity: object
  /** The entity inspected, so re-aiming at another layer cannot be answered. */
  readonly entityId: string
  /** Which kind of entity the id names. */
  readonly kind: InspectionTarget['kind']
  /** The immutable head the answer must belong to. */
  readonly expectedGenerationId: string | null
}

let requestCounter = 0
let session: InspectionSession | null = null

/**
 * The scene point inspector currently armed on the canvas, or null.
 *
 * Holding the disposer rather than a bare function is what lets `endInspection`
 * release the gesture in the same step it clears the target, so no pointer
 * handler outlives the session that installed it.
 */
let pointerDisposer: (() => void) | null = null

/**
 * The document session an inspection session belongs to.
 *
 * A Design replacement is a different document with different presentation, so
 * the session must end rather than re-point at whatever the same reference id
 * means in the new document.
 */
function currentDesignIdentity(): object {
  return designSessionStore.sessionIdentity.value
}

/** Whether one aimed request is still the live one for the live entity. */
function isCurrent(mine: InspectionSession): boolean {
  const target = inspectionSession.value
  return (
    session !== null &&
    session.request === mine.request &&
    session.entityId === mine.entityId &&
    target !== null &&
    target.id === mine.entityId &&
    target.kind === mine.kind &&
    // Design replacement invalidates the whole session, not only its request.
    currentDesignIdentity() === mine.designIdentity
  )
}

function nextRequest(): number {
  requestCounter += 1
  return requestCounter
}

/**
 * Enter inspection mode for one presented layer.
 *
 * Hiding that layer, removing it from the Design, replacing the Design,
 * navigating to Location or tearing the workspace down all leave this mode, so
 * the mode can never outlive the entity it describes. Any previous lookup is
 * cancelled before the session is overwritten, including same-target re-entry.
 */
export function beginInspection(target: InspectionTarget): void {
  // Cancel before replacement so re-aiming cannot orphan a live read.
  cancelPendingLookup(session)
  const designIdentity = currentDesignIdentity()
  session = {
    request: nextRequest(),
    designIdentity,
    entityId: target.id,
    kind: target.kind,
    expectedGenerationId: null,
    pendingRequestId: null,
  }
  inspectionSession.value = target
  inspectionLocation.value = null
  inspectionSample.value = { kind: 'idle' }
  lastObservedGenerationId = readCurrentGenerationId(target)
  // Arm the canvas gesture here so entering inspection cannot leave the mode
  // active but unable to receive a click.
  installInspectionPointerHandler()
  installInspectionObserver()
  reconcileInspectionWithPresentation()
}

/**
 * Cancel the lookup this session still has in flight, if any.
 *
 * Fire-and-forget by design: the signal is a bounded in-memory flag, and the
 * surface must not wait on a round trip to leave a mode the user has exited.
 */
function cancelPendingLookup(active: InspectionSession | null): void {
  const requestId = active?.pendingRequestId
  if (!requestId) return
  void lidarCancelSamplePixel(requestId).catch(() => {
    // A failed cancellation only means the read finishes on its own; the
    // response is fenced anyway, so it cannot publish.
  })
}

/** Leave inspection mode and release every pending lookup. */
export function endInspection(): void {
  cancelPendingLookup(session)
  session = null
  inspectionSession.value = null
  inspectionLocation.value = null
  inspectionSample.value = { kind: 'idle' }
  lastObservedGenerationId = null
  // Release the gesture and the observer in the same step, so a later ordinary
  // click is drawing again and no handler or subscription outlives the session.
  releaseInspectionPointerHandler()
  disposeInspectionObserver()
}

/**
 * Abandon inspection if its layer is no longer presented or no longer visible.
 *
 * Called from the presentation owner and the reactive observer rather than by
 * polling, so a hidden or removed layer drops the mode in the same interaction
 * that changed it. A Design replacement presents a different library view, so
 * the same check also ends a session whose Design is gone.
 */
export function reconcileInspectionWithPresentation(): void {
  const target = inspectionSession.value
  if (!target) return
  if (session && session.designIdentity !== currentDesignIdentity()) {
    endInspection()
    return
  }
  const presented = readLidarPresentation(currentDesign.value, lidarLibrary.value).find(
    (item) => item.id === target.id,
  )
  if (!presented || !presented.visible) {
    endInspection()
    return
  }
  // A head change under an armed target invalidates displayed and pending
  // answers without ending the session: the user may re-aim for a fresh sample.
  const generation = readCurrentGenerationId(target)
  if (lastObservedGenerationId !== generation) {
    lastObservedGenerationId = generation
    invalidateAnswersForHeadChange()
  }
}

/**
 * Cancel any in-flight lookup and mark displayed answers stale after a head
 * change. The target stays armed so the next aim samples the new head.
 */
function invalidateAnswersForHeadChange(): void {
  cancelPendingLookup(session)
  if (session) {
    session = { ...session, pendingRequestId: null, request: nextRequest() }
  }
  const sample = inspectionSample.value
  if (
    sample.kind === 'value' ||
    sample.kind === 'no-data' ||
    sample.kind === 'loading'
  ) {
    inspectionSample.value = { kind: 'stale' }
  }
}

/** The generation the observer last accepted for the inspected entity. */
let lastObservedGenerationId: string | null = null

let inspectionObserverDisposer: (() => void) | null = null

/**
 * Install one disposable observer of Design identity, entity presence and
 * displayed generation for the active inspection session.
 *
 * Hide/remove, Design replacement, leaving Canvas and a published head
 * change all arrive here reactively, so a completed answer cannot silently
 * outlive the generation it was read from even when no action module runs.
 */
export function installInspectionObserver(): () => void {
  disposeInspectionObserver()
  inspectionObserverDisposer = effect(() => {
    const target = inspectionSession.value
    // Subscribe to the identities the fence depends on.
    void designSessionStore.sessionIdentity.value
    void currentDesign.value
    void lidarLibrary.value
    const panel = activePanel.value
    if (!target) {
      lastObservedGenerationId = null
      return
    }
    // Leaving Canvas for any other primary surface ends the
    // canvas gesture and releases its inspection session.
    if (panel !== 'canvas') {
      endInspection()
      return
    }
    reconcileInspectionWithPresentation()
  })
  return disposeInspectionObserver
}

export function disposeInspectionObserver(): void {
  inspectionObserverDisposer?.()
  inspectionObserverDisposer = null
}

/**
 * Sample one WGS84 point of the inspected layer.
 *
 * The point is produced by the canvas's own `worldToGeo`, so it is the
 * geographic position the canvas actually drew rather than an approximation
 * reconstructed here. The displayed coordinate is that same point.
 */
export async function sampleInspectionPoint(point: InspectionPoint): Promise<void> {
  const target = inspectionTarget.value
  if (!target || !session) return
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
    // Supersede any older pending answer so it cannot publish after this refusal.
    cancelPendingLookup(session)
    session = { ...session, pendingRequestId: null, request: nextRequest() }
    inspectionSample.value = { kind: 'unavailable', reason: 'bad-point' }
    return
  }

  // The expected generation is the one presentation currently reports, so a
  // head that changed since the aim is refused natively rather than answered
  // from different bytes.
  const presented = readLidarPresentation(currentDesign.value, lidarLibrary.value).find(
    (item) => item.id === target.id,
  )
  const expectedGenerationId = readCurrentGenerationId(target)
  if (!presented || !expectedGenerationId) {
    // Same fence as a bad point: an older pending lookup must not become current.
    cancelPendingLookup(session)
    session = { ...session, pendingRequestId: null, request: nextRequest() }
    inspectionSample.value = { kind: 'unavailable', reason: 'missing-generation' }
    return
  }

  // Re-arm the session with the same Design and entity but a new request, so
  // this lookup supersedes any still in flight.
  // A new aim supersedes the previous lookup, so the native read it may still
  // be running is cancelled rather than left to occupy the bounded queue.
  cancelPendingLookup(session)
  const request = nextRequest()
  const requestId = String(request)
  const mine: InspectionSession = {
    ...session,
    request,
    pendingRequestId: requestId,
    expectedGenerationId,
  }
  session = mine
  lastObservedGenerationId = expectedGenerationId
  inspectionSample.value = { kind: 'loading' }
  inspectionLocation.value = point

  let outcome: LidarSampleOutcome
  try {
    outcome = await lidarSamplePixel({
      kind: target.kind,
      entity_id: target.id,
      expected_generation_id: expectedGenerationId,
      request_id: requestId,
      longitude: point.lon,
      latitude: point.lat,
    })
  } catch {
    if (isCurrent(mine)) {
      inspectionSample.value = { kind: 'unavailable', reason: 'request-failed' }
    }
    return
  }
  // A superseded, exited or re-aimed lookup publishes nothing at all: the
  // session identity, the Design, the entity and the request must all still be
  // the ones this lookup was aimed at.
  if (session === mine) session = { ...mine, pendingRequestId: null }
  if (!isCurrent(mine)) {
    // Release anything a session that ended underneath this lookup still owned
    // — its canvas gesture in particular. A merely superseded request leaves the
    // live session alone.
    reconcileInspectionWithPresentation()
    return
  }
  // The head can also have moved while the answer was in flight. The native side
  // checked currency before reading, so this covers the window after that read:
  // an answer for a generation the presentation no longer reports is stale, not
  // current.
  if (readCurrentGenerationId(target) !== mine.expectedGenerationId) {
    inspectionSample.value = { kind: 'stale' }
    return
  }
  inspectionSample.value = interpretOutcome(outcome)
}

/** Translate one native outcome into the read-only surface's state. */
export function interpretOutcome(outcome: LidarSampleOutcome): InspectionSample {
  if ('Value' in outcome) {
    const value = outcome.Value
    if (!Number.isFinite(value.value)) return { kind: 'no-data' }
    return { kind: 'value', value: value.value, units: value.units }
  }
  if ('NoData' in outcome) return { kind: 'no-data' }
  const reason = outcome.Unavailable.reason
  // A stale generation is recoverable by re-aiming; the others are not.
  if (reason === 'StaleGeneration') return { kind: 'stale' }
  return { kind: 'unavailable', reason: String(reason) }
}

/**
 * The immutable generation presentation currently reports for one entity.
 *
 * Reading it from the library snapshot keeps the expected-generation fence
 * derived from the same generation the map display descriptor is drawing.
 */
function readCurrentGenerationId(target: InspectionTarget): string | null {
  const library = lidarLibrary.value
  if (!library) return null
  const entity = target.kind === 'Source'
    ? library.layers.find((candidate) => candidate.id === target.id)
    : library.analyses.find((candidate) => candidate.id === target.id)
  return entity?.generation_id ?? null
}

/**
 * The live pointer handler, when a surface is inspecting.
 *
 * The canvas interaction session is built once, long before any inspection
 * session exists, so it cannot receive the handler as a dependency value.
 * Instead it calls `tryInspectAt`, which consults this registry per gesture.
 * That keeps the interaction owner single: inspection borrows the existing
 * gesture rather than installing a competing listener.
 */
let pointerHandler: ((point: { x: number; y: number }) => boolean) | null = null

/** Publish or withdraw the handler the canvas gesture consults. */
export function setInspectionPointerHandler(
  handler: ((point: { x: number; y: number }) => boolean) | null,
): void {
  pointerHandler = handler
}

/**
 * Offer one scene point to the inspection session.
 *
 * Returns whether inspection claimed the gesture. It declines when no surface is
 * inspecting, so the canvas keeps its normal drawing and selection behaviour.
 */
export function tryInspectAt(point: { x: number; y: number }): boolean {
  return pointerHandler ? pointerHandler(point) : false
}

/**
 * Install the pointer handler that samples the clicked scene point.
 *
 * The disposer is kept by the session, so `endInspection` and any teardown both
 * release it: a leaked handler would keep claiming clicks for a session that no
 * longer exists.
 */
export function installInspectionPointerHandler(): () => void {
  setInspectionPointerHandler((point) => sampleInspectionScenePoint(point))
  const dispose = () => setInspectionPointerHandler(null)
  pointerDisposer = dispose
  return dispose
}

/** Release the installed pointer handler, if one is installed. */
export function releaseInspectionPointerHandler(): void {
  pointerDisposer?.()
  pointerDisposer = null
}

/** Whether a canvas gesture handler is currently installed. */
export function hasInspectionPointerHandler(): boolean {
  return pointerHandler !== null
}

/**
 * Sample a scene point, for the canvas gesture and the status surface's button.
 *
 * The keyboard/pointer parity the contract requires is exactly this: the button
 * calls the same session and the same native command as a click, so a user
 * without a pointer can still read a value.
 */
export function sampleInspectionScenePoint(point: { x: number; y: number }): boolean {
  if (!inspectionTarget.value) return false
  const aim = inspectionPointForScenePoint(point)
  if (!aim) return false
  void sampleInspectionPoint(aim)
  return true
}

/**
 * Sample the current viewport centre, so pointer use is never required.
 *
 * Returns whether a sample was submitted. The button that calls this is the
 * keyboard-reachable half of the same command the canvas pointer invokes.
 */
export function sampleInspectionCentre(): boolean {
  const centre = inspectionViewCentreScenePoint()
  if (!centre) return false
  return sampleInspectionScenePoint(centre)
}
