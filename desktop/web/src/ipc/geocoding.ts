import { invoke } from '@tauri-apps/api/core'
import type { GeoResult } from '../generated/contracts'

export type { GeoResult }

export async function geocodeAddress(query: string): Promise<GeoResult[]> {
  return invoke('geocode_address', { query })
}
