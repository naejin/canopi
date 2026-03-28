import { invoke } from '@tauri-apps/api/core'

export interface GeoResult {
  display_name: string
  lat: number
  lon: number
}

export async function geocodeAddress(query: string): Promise<GeoResult[]> {
  return invoke('geocode_address', { query })
}
