import type { convertFileSrc } from '@tauri-apps/api/core'
import type { LidarTileset } from '../../ipc/lidar'

/**
 * MapLibre raster tile URL for a library tileset.
 *
 * Rust returns an absolute filesystem path template ending in
 * `{z}_{x}_{y}.png`; the webview resolves the directory through the scoped
 * asset protocol (platform-aware: `asset://` on Linux/macOS,
 * `http://asset.localhost/` on Windows). The `{z}_{x}_{y}` suffix stays
 * unencoded so MapLibre substitutes tile coordinates into the path.
 */
export function lidarTileUrlTemplate(
  tileset: Pick<LidarTileset, 'path_template'>,
  toAssetUrl: typeof convertFileSrc = defaultToAssetUrl,
): string {
  const template = tileset.path_template.replace(/\\/g, '/')
  const marker = '/{z}_{x}_{y}.png'
  const markerIndex = template.lastIndexOf(marker)
  const directory = markerIndex >= 0 ? template.slice(0, markerIndex) : template
  return `${toAssetUrl(directory)}${marker}`
}

function defaultToAssetUrl(path: string): string {
  // Replicates Tauri v2 `convertFileSrc` without importing the API in tests.
  const encoded = encodeURIComponent(path)
  const platform = typeof navigator !== 'undefined' ? navigator.platform : ''
  return platform.startsWith('Win')
    ? `http://asset.localhost/${encoded}`
    : `asset://localhost/${encoded}`
}
