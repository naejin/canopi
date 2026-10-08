import { effect, signal } from '@preact/signals'
import type { convertFileSrc } from '@tauri-apps/api/core'
import type { RasterDisplayLayer } from '../../maplibre/raster-display/adapter'
import { lidarDisplayDescriptor, type LidarDisplayDescriptor } from '../../ipc/lidar'
import type { LibraryItemRole } from '../../generated/contracts'
import { cutOutlierRange, requestCutOutlierRange, resetCutOutlierRanges } from './display-range'
import { itemTypeStyle, type LidarDisplayStyle, type RasterStyleInput } from './item-types'
import { storyPresentationOverrides } from '../story-presentation/overrides'
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

export function displayKey(kind: LibraryItemRole, entityId: string, generationId: string | null): string {
  return `${kind}/${entityId}/${generationId ?? ''}`
}

export function readLidarDisplay(
  kind: LibraryItemRole,
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
  kind: LibraryItemRole,
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

/**
 * Whether the map draws an entry: as a presented story step shows it (its
 * library ids), else as the Design shows it (`shown`). Only the map reads the
 * story override, since the side dock is closed while a story is presented.
 */
function mapShown(
  item: Pick<LidarPresentationItem, 'id' | 'shown'>,
  presentedIds: ReadonlySet<string> | null,
): boolean {
  return presentedIds ? presentedIds.has(item.id) : item.shown
}

let displayDisposer: (() => void) | null = null

/**
 * Keep descriptors current for every reference the map draws, a presented
 * story step's included, and read Cut outliers' range of every entry set to
 * it once its display is ready (`toAssetUrl` serves the display COGs).
 * Installed for the Desktop workspace lifetime next to the library workflow.
 */
export function installLidarDisplayDescriptors(toAssetUrl: (path: string) => string = lidarAssetUrl): void {
  disposeLidarDisplayDescriptors()
  displayDisposer = effect(() => {
    const presentedIds = storyPresentationOverrides.value?.siteDataIds ?? null
    const descriptors = lidarDisplayDescriptors.value
    for (const item of readCurrentLidarPresentation()) {
      if (item.availability !== 'present' || !item.generationId) continue
      if (mapShown(item, presentedIds)) requestLidarDisplay(item.kind, item.id, item.generationId)
      if (item.range?.mode !== 'CutOutliers') continue
      const key = displayKey(item.kind, item.id, item.generationId)
      const descriptor = descriptors.get(key)
      if (descriptor?.state === 'Ready' && descriptor.generation_id === item.generationId) {
        requestCutOutlierRange(key, descriptor.assets.map((asset) => toAssetUrl(asset.path)))
      }
    }
  })
}

export function disposeLidarDisplayDescriptors(): void {
  displayDisposer?.()
  displayDisposer = null
  storeGeneration += 1
  resetCutOutlierRanges()
  for (const timer of pollTimers.values()) clearTimeout(timer)
  pollTimers.clear()
  inflight.clear()
}

/** Replicates Tauri v2 `convertFileSrc` so pure projection stays testable. */
export function lidarAssetUrl(path: string): string {
  const encoded = encodeURIComponent(path)
  const platform = typeof navigator !== 'undefined' ? navigator.platform : ''
  return platform.startsWith('Win') ? `http://asset.localhost/${encoded}` : `asset://localhost/${encoded}`
}

/**
 * Upstream palette and stretch for one entry, always in its item's stored
 * units: its own ramp, Reverse and range over its item type's defaults, with
 * Cut outliers' range once it is read. A reference whose item is gone has no
 * type: it draws nothing and has no legend.
 */
export function lidarDisplayStyle(
  item: RasterStyleInput & Pick<LidarPresentationItem, 'kind' | 'id' | 'generationId' | 'itemType'>,
): LidarDisplayStyle | null {
  if (!item.itemType) return null
  const cutRange = item.range?.mode === 'CutOutliers' && item.generationId
    ? cutOutlierRange(displayKey(item.kind, item.id, item.generationId))
    : null
  return itemTypeStyle(item.itemType, { ...item, cutRange })
}

/**
 * Project the references the map draws (`mapShown`) into renderer layers,
 * back to front. A reference whose derivatives are not ready draws nothing
 * yet; the rest of the band keeps rendering.
 */
export function lidarDisplayLayers(
  items: readonly LidarPresentationItem[],
  descriptors: ReadonlyMap<string, LidarDisplayDescriptor>,
  presentedIds: ReadonlySet<string> | null,
  toAssetUrl: typeof convertFileSrc = lidarAssetUrl,
): RasterDisplayLayer[] {
  const layers: RasterDisplayLayer[] = []
  for (const item of items) {
    if (!mapShown(item, presentedIds) || item.availability !== 'present' || !item.generationId) continue
    const descriptor = descriptors.get(displayKey(item.kind, item.id, item.generationId))
    if (!descriptor || descriptor.state !== 'Ready' || descriptor.generation_id !== item.generationId) continue
    if (descriptor.assets.length === 0) continue
    const style = lidarDisplayStyle(item)
    if (!style) continue
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
      id: `lidar-${item.kind === 'Derived' ? 'result' : 'source'}-${item.id}-${item.generationId}`,
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
