import { signal } from '@preact/signals'
import type { SavedObjectStamp } from '../src/types/saved-object-stamps'
import { detail, designFixture, species } from './fixtures'

const state = new URLSearchParams(location.search).get('state') ?? 'populated'
const favoriteNames = new Set(state === 'empty' ? [] : species.map(plant => plant.canonical_name))
const file = designFixture()
let sequence = 3
let stamps: SavedObjectStamp[] = state === 'empty' ? [] : ['Orchard guild', 'Pollinator border'].map((name, index) => ({
  id: `stamp-${index}`, name: state === 'long' ? name + ' — a reusable arrangement with a particularly long descriptive name' : name, sort_order: index,
  payload_json: JSON.stringify({ version: 1, anchor: { x: 0, y: 0 }, plants: file.plants.slice(index * 3, index * 3 + 3).map(plant => ({ id: plant.id, canonicalName: plant.canonical_name, commonName: plant.common_name, position: plant.position, color: null, rotationDeg: null, scale: null })), zones: [], annotations: [], groups: [] }),
  created_at: file.created_at, updated_at: file.updated_at,
}))
export const activity = signal('All changes stay in memory. Reload to reset.')
export function convertFileSrc(path: string) { return path }
export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const canonicalName = String(args.canonicalName ?? '')
  const plant = species.find(plant => plant.canonical_name === canonicalName) ?? species[0]!
  let result: unknown
  switch (command) {
    case 'get_favorites': result = species.filter(plant => favoriteNames.has(plant.canonical_name)).map(plant => ({ ...plant, common_name: state === 'long' ? plant.common_name + ' — a particularly long local cultivar name' : plant.common_name })); break
    case 'get_recently_viewed': result = []; break
    case 'toggle_favorite':
      if (favoriteNames.has(canonicalName)) favoriteNames.delete(canonicalName)
      else favoriteNames.add(canonicalName)
      result = favoriteNames.has(canonicalName); break
    case 'get_species_detail': result = { ...detail, canonical_name: canonicalName, common_name: plant.common_name }; break
    case 'get_species_batch': result = species.map(plant => ({ ...detail, ...plant })); break
    case 'get_common_names': result = Object.fromEntries(species.map(plant => [plant.canonical_name, plant.common_name])); break
    case 'get_locale_common_names':
    case 'get_species_images':
    case 'get_dynamic_filter_options': result = []; break
    case 'get_filter_options': result = { families: [], growth_rates: [], climate_zones: [], habits: [], life_cycles: [], sun_tolerances: [], soil_tolerances: [] }; break
    case 'supersede_species_search': result = undefined; break
    case 'search_species': result = { items: species, total: species.length, next_cursor: null }; break
    case 'get_saved_object_stamps': result = stamps; break
    case 'create_saved_object_stamp':
      result = { id: `stamp-${sequence++}`, name: String(args.name), payload_json: String(args.payloadJson), sort_order: stamps.length, created_at: file.created_at, updated_at: file.updated_at }
      stamps = [...stamps, result as SavedObjectStamp]; break
    case 'rename_saved_object_stamp':
      stamps = stamps.map(stamp => stamp.id === args.id ? { ...stamp, name: String(args.name) } : stamp)
      result = stamps.find(stamp => stamp.id === args.id); break
    case 'delete_saved_object_stamp':
      stamps = stamps.filter(stamp => stamp.id !== args.id); result = true; break
    case 'reorder_saved_object_stamps':
      stamps = (args.ids as string[]).map((id, sort_order) => ({ ...stamps.find(stamp => stamp.id === id)!, sort_order }))
      result = stamps; break
    case 'export_saved_object_stamp_canopi_file':
      activity.value = 'Export completed in memory.'; result = 'gallery-export.canopi'; break
    case 'load_saved_object_stamp_canopi_file':
      activity.value = 'Imported the sample design in memory.'; result = file; break
    default: throw new Error(`Gallery backend has no fixture for ${command}.`)
  }
  return structuredClone(result) as T
}
