import { signal } from '@preact/signals'
import type { LidarSampleOutcome } from '../../generated/contracts'
import { lidarSamplePixel } from '../../ipc/lidar'
import { currentDesign } from '../document-session/store'
import { readLidarPresentation, lidarLibrary } from './library-store'

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

/** The layer inspection is aimed at, or null when inspection is off. */
export const inspectionTarget = signal<InspectionTarget | null>(null)

/** The result of the most recent lookup for the current target. */
export const inspectionSample = signal<InspectionSample>({ kind: 'idle' })

/** Where the last sample was taken, for the read-only status surface. */
export const inspectionLocation = signal<{ lat: number; lon: number } | null>(null)

/**
 * The current inspection generation.
 *
 * Every aim, every sample and every exit advances it. A response may only
 * publish when its own generation is still current, so a slow answer can never
 * be shown as the result for a layer, head or Design the user has already left.
 */
let generation = 0

function nextGeneration(): number {
  generation += 1
  return generation
}

function isCurrent(candidate: number): boolean {
  return candidate === generation && inspectionTarget.value !== null
}

/**
 * Enter inspection mode for one presented layer.
 *
 * Hiding that layer, removing it from the Design, replacing the Design,
 * navigating to Location or tearing the workspace down all leave this mode, so
 * the mode can never outlive the entity it describes.
 */
export function beginInspection(target: InspectionTarget): void {
  nextGeneration()
  inspectionTarget.value = target
  inspectionLocation.value = null
  inspectionSample.value = { kind: 'idle' }
  reconcileInspectionWithPresentation()
}

/** Leave inspection mode and release every pending lookup. */
export function endInspection(): void {
  nextGeneration()
  inspectionTarget.value = null
  inspectionLocation.value = null
  inspectionSample.value = { kind: 'idle' }
}

/**
 * Abandon inspection if its layer is no longer presented or no longer visible.
 *
 * Called from the presentation owner rather than by polling, so a hidden or
 * removed layer drops the mode in the same interaction that changed it.
 */
export function reconcileInspectionWithPresentation(): void {
  const target = inspectionTarget.value
  if (!target) return
  const presented = readLidarPresentation(currentDesign.value, lidarLibrary.value).find(
    (item) => item.id === target.id,
  )
  if (!presented || !presented.visible) {
    endInspection()
  }
}

/**
 * Sample one point of the inspected layer.
 *
 * `anchor` is the Design's own anchor and the offset is the scene metre
 * displacement of the point from it, which is what the canvas actually knows.
 * The native side projects the anchor and applies the offset there, so the
 * selected cell is as accurate as a native read.
 */
export async function sampleInspectionPoint(point: {
  readonly anchor: { readonly lat: number; readonly lon: number }
  readonly eastMetres: number
  readonly northMetres: number
  readonly northBearingDeg: number
}): Promise<void> {
  const target = inspectionTarget.value
  if (!target) return

  // The expected generation is the one presentation currently reports, so a
  // head that changed since the aim is refused natively rather than answered
  // from different bytes.
  const presented = readLidarPresentation(currentDesign.value, lidarLibrary.value).find(
    (item) => item.id === target.id,
  )
  const expectedGenerationId = readCurrentGenerationId(target)
  if (!presented || !expectedGenerationId) {
    inspectionSample.value = { kind: 'unavailable', reason: 'missing-generation' }
    return
  }

  const mine = nextGeneration()
  inspectionSample.value = { kind: 'loading' }
  inspectionLocation.value = { lat: point.anchor.lat, lon: point.anchor.lon }

  let outcome: LidarSampleOutcome
  try {
    outcome = await lidarSamplePixel({
      kind: target.kind,
      entity_id: target.id,
      expected_generation_id: expectedGenerationId,
      longitude: point.anchor.lon,
      latitude: point.anchor.lat,
      scene_offset_metres: {
        east_metres: point.eastMetres,
        north_metres: point.northMetres,
        north_bearing_deg: point.northBearingDeg,
      },
    })
  } catch {
    if (isCurrent(mine)) {
      inspectionSample.value = { kind: 'unavailable', reason: 'request-failed' }
    }
    return
  }
  // A superseded, exited or re-aimed lookup publishes nothing at all.
  if (!isCurrent(mine)) return
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
 * A source reports its tileset's native generation; an analysis reports its own
 * result generation. Reading it here keeps the expected-generation fence derived
 * from the same presentation the map is drawing.
 */
function readCurrentGenerationId(target: InspectionTarget): string | null {
  const library = lidarLibrary.value
  if (!library) return null
  if (target.kind === 'Source') {
    const layer = library.layers.find((candidate) => candidate.id === target.id)
    const tileset = layer?.tilesets.find(
      (candidate) => candidate.source.kind === 'native-generation',
    )
    return tileset && 'generation_id' in tileset.source ? tileset.source.generation_id : null
  }
  const analysis = library.analyses.find((candidate) => candidate.id === target.id)
  const tileset = analysis?.tilesets.find(
    (candidate) => candidate.source.kind === 'native-generation',
  )
  return tileset && 'generation_id' in tileset.source ? tileset.source.generation_id : null
}
