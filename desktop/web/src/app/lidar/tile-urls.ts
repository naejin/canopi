import type { convertFileSrc } from '@tauri-apps/api/core'
import type { LidarTileset } from '../../ipc/lidar'

/** Scheme MapLibre dispatches to the desktop raster protocol adapter. */
export const NATIVE_RASTER_SCHEME = 'canopi-raster'

/**
 * Entity kinds a native tile request may name.
 *
 * The library's own vocabulary (lower case, matching `lidar_generation_chunks`
 * ownership) is distinct from the Design's presentation entry kind
 * (`Source`/`Analysis`), so the mapping is explicit rather than a cast.
 */
export type LidarTileEntityKind = 'source' | 'analysis'

/** Map a Design presentation entry kind onto the library's entity kind. */
export function tileEntityKind(
  kind: 'Source' | 'Analysis',
): LidarTileEntityKind {
  return kind === 'Analysis' ? 'analysis' : 'source'
}

/** Identity a native tile request needs beyond the tileset itself. */
export type LidarTileIdentity = {
  entityKind: LidarTileEntityKind
  entityId: string
}

/**
 * MapLibre raster tile URL for a library tileset.
 *
 * A preserved generation still resolves its published pyramid through the
 * scoped asset protocol (platform-aware: `asset://` on Linux/macOS,
 * `http://asset.localhost/` on Windows). A generation stored as sparse
 * resolved chunks has no pyramid and no filesystem path, so its template names
 * the raster protocol instead and the adapter renders each tile on demand. The
 * `{z}/{x}/{y}` suffix stays unencoded so MapLibre substitutes into it.
 */
export function lidarTileUrlTemplate(
  tileset: LidarTileset,
  identity: LidarTileIdentity,
  toAssetUrl: typeof convertFileSrc = defaultToAssetUrl,
): string {
  const source = tileset.source
  if (source.kind === 'native-generation') {
    const entity = encodeURIComponent(identity.entityId)
    return (
      `${NATIVE_RASTER_SCHEME}://tile/${identity.entityKind}/${entity}/` +
      `${encodeURIComponent(source.generation_id)}/${encodeURIComponent(tileset.style)}` +
      '/{z}/{x}/{y}.png'
    )
  }
  const template = source.path_template.replace(/\\/g, '/')
  const marker = '/{z}_{x}_{y}.png'
  const markerIndex = template.lastIndexOf(marker)
  const directory = markerIndex >= 0 ? template.slice(0, markerIndex) : template
  return `${toAssetUrl(directory)}${marker}`
}

/** One parsed native raster tile request. */
export type NativeTileRequest = LidarTileIdentity & {
  generationId: string
  style: string
  z: number
  x: number
  y: number
}

/**
 * Parse one `canopi-raster://` tile URL into the request the native command
 * takes, or null when the URL is not a raster tile request.
 */
export function parseNativeTileUrl(url: string): NativeTileRequest | null {
  const prefix = `${NATIVE_RASTER_SCHEME}://`
  if (!url.startsWith(prefix)) {
    return null
  }
  const withoutScheme = url.slice(prefix.length)
  const query = withoutScheme.indexOf('?')
  const path = query >= 0 ? withoutScheme.slice(0, query) : withoutScheme
  const parts = path.split('/').filter((part) => part.length > 0)
  // tile/<entityKind>/<entityId>/<generationId>/<style>/<z>/<x>/<y>.png
  if (parts.length !== 8) {
    return null
  }
  const [head, entityKind, entityId, generationId, style, rawZ, rawX, rawY] = parts
  if (
    head !== 'tile' ||
    (entityKind !== 'source' && entityKind !== 'analysis') ||
    !entityId ||
    !generationId ||
    !style ||
    !rawZ ||
    !rawX ||
    !rawY
  ) {
    return null
  }
  const tileY = rawY.endsWith('.png') ? rawY.slice(0, -4) : rawY
  const z = Number(rawZ)
  const x = Number(rawX)
  const y = Number(tileY)
  if (![z, x, y].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    return null
  }
  return {
    entityKind,
    entityId: decodeURIComponent(entityId),
    generationId: decodeURIComponent(generationId),
    style: decodeURIComponent(style),
    z,
    x,
    y,
  }
}

function defaultToAssetUrl(path: string): string {
  // Replicates Tauri v2 `convertFileSrc` without importing the API in tests.
  const encoded = encodeURIComponent(path)
  const platform = typeof navigator !== 'undefined' ? navigator.platform : ''
  return platform.startsWith('Win')
    ? `http://asset.localhost/${encoded}`
    : `asset://localhost/${encoded}`
}
