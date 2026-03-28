import { invoke } from '@tauri-apps/api/core'

export interface OfflineStatus {
  available: boolean
  bbox: [number, number, number, number] | null
  min_zoom: number | null
  max_zoom: number | null
  tile_count: number
  size_bytes: number
}

export interface TileDownloadProgress {
  downloaded: number
  total: number
  current_zoom: number
}

export async function downloadTiles(
  bbox: [number, number, number, number],
  minZoom: number,
  maxZoom: number,
): Promise<void> {
  return invoke('download_tiles', { bbox, minZoom, maxZoom })
}

export async function getTile(z: number, x: number, y: number): Promise<number[]> {
  return invoke('get_tile', { z, x, y })
}

export async function getOfflineStatus(): Promise<OfflineStatus> {
  return invoke('get_offline_status')
}

export async function removeOfflineTiles(): Promise<void> {
  return invoke('remove_offline_tiles')
}
