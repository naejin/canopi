import { effect, signal } from '@preact/signals'
import type { convertFileSrc } from '@tauri-apps/api/core'
import type { RasterDisplayLayer } from '../../maplibre/raster-display/adapter'
import { lidarDisplayDescriptor, type LidarDisplayDescriptor } from '../../ipc/lidar'
import type { LidarSampleEntityKind } from '../../generated/contracts'
import { readCurrentLidarPresentation, refreshLidarLibrary, type LidarPresentationItem } from './library-store'

/**
 * Display descriptors of library entities, keyed by entity and generation.
 *
 * The library owns derivative preparation; this store only asks for the
 * descriptor of each generation something wants to draw (a visible Design
 * reference or a library preview) and polls while it is preparing. Entries are
 * identity-keyed, so a descriptor of an older generation can never be used for
 * a newer one.
 */
export const lidarDisplayDescriptors = signal<ReadonlyMap<string, LidarDisplayDescriptor>>(new Map())

const PREPARING_POLL_MS = 800
const MAX_ENTRIES = 256

const inflight = new Set<string>()
const pollTimers = new Map<string, ReturnType<typeof setTimeout>>()
let storeGeneration = 0

export function displayKey(kind: LidarSampleEntityKind, entityId: string, generationId: string | null): string {
  return `${kind}/${entityId}/${generationId ?? ''}`
}

export function readLidarDisplay(
  kind: LidarSampleEntityKind,
  entityId: string,
  generationId: string | null,
): LidarDisplayDescriptor | null {
  return lidarDisplayDescriptors.value.get(displayKey(kind, entityId, generationId)) ?? null
}

function store(key: string, descriptor: LidarDisplayDescriptor): void {
  const next = new Map(lidarDisplayDescriptors.value)
  next.delete(key)
  next.set(key, descriptor)
  while (next.size > MAX_ENTRIES) next.delete(next.keys().next().value!)
  lidarDisplayDescriptors.value = next
}

/**
 * Ask the library for one generation's descriptor unless an answer that does
 * not change on its own (ready, unavailable, failed) is already stored.
 */
export function requestLidarDisplay(
  kind: LidarSampleEntityKind,
  entityId: string,
  generationId: string | null,
  options: { retry?: boolean } = {},
): void {
  const key = displayKey(kind, entityId, generationId)
  const current = lidarDisplayDescriptors.value.get(key)
  if (!options.retry && current && current.state !== 'Preparing') return
  if (inflight.has(key) || (!options.retry && pollTimers.has(key))) return
  inflight.add(key)
  const owner = storeGeneration
  void lidarDisplayDescriptor({
    kind,
    entity_id: entityId,
    expected_generation_id: generationId,
    retry: options.retry ?? false,
  })
    .then((descriptor) => {
      if (owner !== storeGeneration) return
      store(key, descriptor)
      if (descriptor.state === 'Preparing') {
        pollTimers.set(key, setTimeout(() => {
          pollTimers.delete(key)
          if (owner === storeGeneration) requestLidarDisplay(kind, entityId, generationId)
        }, PREPARING_POLL_MS))
      } else if (descriptor.state === 'Stale') {
        // The item moved on: a fresh library read brings the new generation.
        void refreshLidarLibrary()
      }
    })
    .catch((error: unknown) => {
      if (owner !== storeGeneration) return
      store(key, {
        kind,
        entity_id: entityId,
        generation_id: generationId,
        profile: '',
        state: 'Failed',
        message: error instanceof Error ? error.message : String(error),
        assets: [],
        prepared_assets: 0,
        total_assets: 0,
      })
    })
    .finally(() => inflight.delete(key))
}

export function entityKind(item: Pick<LidarPresentationItem, 'kind'>): LidarSampleEntityKind {
  return item.kind === 'Analysis' ? 'Analysis' : 'Source'
}

let displayDisposer: (() => void) | null = null

/**
 * Keep descriptors current for every visible reference of the current Design.
 * Installed for the Desktop workspace lifetime next to the library workflow.
 */
export function installLidarDisplayDescriptors(): void {
  disposeLidarDisplayDescriptors()
  displayDisposer = effect(() => {
    for (const item of readCurrentLidarPresentation()) {
      if (!item.visible || item.state === 'unavailable' || !item.generationId) continue
      requestLidarDisplay(entityKind(item), item.id, item.generationId)
    }
  })
}

export function disposeLidarDisplayDescriptors(): void {
  displayDisposer?.()
  displayDisposer = null
  storeGeneration += 1
  for (const timer of pollTimers.values()) clearTimeout(timer)
  pollTimers.clear()
  inflight.clear()
}

/** Replicates Tauri v2 `convertFileSrc` so pure projection stays testable. */
function defaultToAssetUrl(path: string): string {
  const encoded = encodeURIComponent(path)
  const platform = typeof navigator !== 'undefined' ? navigator.platform : ''
  return platform.startsWith('Win') ? `http://asset.localhost/${encoded}` : `asset://localhost/${encoded}`
}

export interface LidarDisplayStyle {
  readonly colormap: string
  readonly reversed: boolean
  readonly rescale: readonly [number, number]
  /** Units of `rescale`, for the legend. */
  readonly units: string
}

const SLOPE_DEGREES_MAX = 60
/** The same 60° expressed in percent, so both units share one colour domain. */
const SLOPE_PERCENT_MAX = Math.round(Math.tan((SLOPE_DEGREES_MAX * Math.PI) / 180) * 1000) / 10

/**
 * Upstream palette and stretch for one item, always in its stored units.
 *
 * Elevation uses `terrain` over the library's display range; heights and other
 * continuous values use `viridis`. Slope uses a reversed `magma` over a fixed
 * domain in the result's own unit, so a percent result is never coloured as
 * degrees.
 */
export function lidarDisplayStyle(item: Pick<LidarPresentationItem, 'kind' | 'detail' | 'slopeUnit' | 'displayRange'>, units: string): LidarDisplayStyle {
  if (item.kind === 'Analysis') {
    const percent = item.slopeUnit === 'Percent'
    return {
      colormap: 'magma',
      reversed: true,
      rescale: [0, percent ? SLOPE_PERCENT_MAX : SLOPE_DEGREES_MAX],
      units: percent ? '%' : '°',
    }
  }
  const [min, max] = item.displayRange ?? [0, 1]
  const rescale: [number, number] = max > min ? [min, max] : [min, min + 1]
  const elevation = item.detail === 'GroundElevation' || item.detail === 'SurfaceElevation'
  return { colormap: elevation ? 'terrain' : 'viridis', reversed: false, rescale, units }
}

/**
 * Project the current Design's visible references into renderer layers,
 * back to front. A reference whose derivatives are not ready draws nothing
 * yet; the rest of the band keeps rendering.
 */
export function lidarDisplayLayers(
  items: readonly LidarPresentationItem[],
  descriptors: ReadonlyMap<string, LidarDisplayDescriptor>,
  unitsOf: (item: LidarPresentationItem) => string = () => '',
  toAssetUrl: typeof convertFileSrc = defaultToAssetUrl,
): RasterDisplayLayer[] {
  const layers: RasterDisplayLayer[] = []
  for (const item of items) {
    if (!item.visible || item.state === 'unavailable' || !item.generationId) continue
    const kind = entityKind(item)
    const descriptor = descriptors.get(displayKey(kind, item.id, item.generationId))
    if (!descriptor || descriptor.state !== 'Ready' || descriptor.generation_id !== item.generationId) continue
    if (descriptor.assets.length === 0) continue
    const style = lidarDisplayStyle(item, unitsOf(item))
    const bounds = descriptor.assets.reduce<[number, number, number, number]>(
      (union, asset) => [
        Math.min(union[0], asset.bounds[0]),
        Math.min(union[1], asset.bounds[1]),
        Math.max(union[2], asset.bounds[2]),
        Math.max(union[3], asset.bounds[3]),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    )
    layers.push({
      id: `lidar-${kind === 'Analysis' ? 'result' : 'source'}-${item.id}-${item.generationId}`,
      name: item.name,
      assets: descriptor.assets.map((asset) => ({ url: toAssetUrl(asset.path), bbox: asset.bounds })),
      bounds,
      opacity: item.opacity,
      rescale: style.rescale,
      colormap: style.colormap,
      reversed: style.reversed,
    })
  }
  return layers
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeLidarDisplayDescriptors()
  })
}
