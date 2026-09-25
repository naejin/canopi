import { signal } from '@preact/signals'
import type { SavedObjectStamp } from '../src/types/saved-object-stamps'
import type {
  LidarAnalysisSummary,
  LidarImportJob,
  LidarLayerSummary,
} from '../src/generated/contracts'
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
const lidarBounds: [number, number, number, number] = [-0.427, 48.305, -0.413, 48.314]
let lidarLayers: LidarLayerSummary[] = state === 'empty' ? [] : [{
  id: 'lidar-ground',
  generation_id: 'lidar-ground-g1',
  name: state === 'long'
    ? 'IGN bare-earth elevation — La Maignannerie regional survey comparison layer'
    : 'IGN ground elevation',
  measurement_kind: 'GroundElevation',
  units: 'm',
  state: 'Ready',
  resolution_m: 0.5,
  coverage_cells: '4000000',
  bounds: lidarBounds,
  value_range: [131.2, 287.8],
  display_range: { min: 131.2, max: 287.8, basis: 'Exact' },
  analysis_count: 1,
  import_job: null,
}]
let lidarAnalyses: LidarAnalysisSummary[] = state === 'empty' ? [] : [{
  id: 'lidar-slope',
  generation_id: 'lidar-slope-g1',
  input_generation_id: 'lidar-ground-g1',
  source_layer_id: 'lidar-ground',
  kind: 'Slope',
  name: null,
  state: 'Ready',
  detail: null,
  bounds: lidarBounds,
  value_range: [0, 41.6],
  slope_unit: 'Degrees',
  method: 'GeolibreProjectedSlopeV1',
  engine_version: 'geolibre-cli 1.5.3 (geolibre-rust aac2b7439786)',
}]
function galleryImport(layerId: string, name: string, kind: LidarLayerSummary['measurement_kind'], job: Partial<LidarImportJob>): LidarLayerSummary {
  return {
    id: layerId, generation_id: null, name, measurement_kind: kind, units: 'm', state: 'Preparing',
    resolution_m: null, coverage_cells: null, bounds: null, value_range: null, display_range: null, analysis_count: 0,
    import_job: { job_id: `job-${layerId}`, layer_id: layerId, state: 'Staging', message: null, progress: { phase: 'PreparingRaster', percent: 42 }, ...job },
  }
}
if (state === 'lidar-progress') {
  lidarLayers = [...lidarLayers,
    galleryImport('lidar-canopy', 'Canopy height 2024', 'AboveGroundHeight', { state: 'Applying', progress: { phase: 'RenderingMap', percent: 68 } }),
    galleryImport('lidar-broken', 'Survey tile 0712', 'SurfaceElevation', { state: 'Failed', message: 'The file is not a readable raster.', progress: null }),
  ]
}
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
    case 'lidar_list_library':
      result = {
        layers: lidarLayers,
        analyses: lidarAnalyses,
        engine: { available: true, version: '3.8.4', detail: null },
        slope_engine: { available: true, version: 'geolibre-cli 1.5.3 (gallery)', detail: null },
      }; break
    case 'lidar_create_analysis': {
      const id = `lidar-analysis-${sequence++}`
      const layerId = String(args.layerId)
      const unit = (args.parameters as { slope_unit?: 'Degrees' | 'Percent' } | undefined)?.slope_unit ?? 'Degrees'
      lidarAnalyses = [...lidarAnalyses, {
        id, generation_id: `${id}-g1`, input_generation_id: `${layerId}-g1`, source_layer_id: layerId,
        kind: 'Slope', name: typeof args.resultName === 'string' ? args.resultName : null, state: 'Ready',
        detail: null, bounds: lidarBounds, value_range: unit === 'Percent' ? [0, 89.4] : [0, 41.6], slope_unit: unit,
        method: 'GeolibreProjectedSlopeV1', engine_version: 'geolibre-cli 1.5.3 (gallery)',
      }]
      lidarLayers = lidarLayers.map(layer => layer.id === layerId ? { ...layer, analysis_count: layer.analysis_count + 1 } : layer)
      activity.value = 'Calculated a slope result in memory.'
      result = { definition_id: id, job_id: `job-${id}` }
      break
    }
    case 'lidar_import_item': {
      const id = `lidar-layer-${sequence++}`
      lidarLayers = [...lidarLayers, galleryImport(id, String(args.name), args.kind as LidarLayerSummary['measurement_kind'], {})]
      activity.value = 'Started a library import in memory.'
      result = { layer_id: id, job_id: `job-${id}` }
      break
    }
    case 'lidar_retry_import':
      lidarLayers = lidarLayers.map(layer => layer.id === args.layerId && layer.import_job
        ? { ...layer, import_job: { ...layer.import_job, state: 'Staging', message: null, progress: { phase: 'PreparingRaster', percent: 5 } } }
        : layer)
      activity.value = 'Retried the import in memory.'
      result = { layer_id: String(args.layerId), job_id: `job-${String(args.layerId)}` }
      break
    case 'lidar_dismiss_import':
    case 'lidar_delete_layer': {
      const id = String(args.layerId)
      lidarLayers = lidarLayers.filter(candidate => candidate.id !== id)
      activity.value = 'Removed the library item in memory.'
      result = undefined
      break
    }
    case 'lidar_cancel_import':
      lidarLayers = lidarLayers.map(layer => layer.import_job && layer.import_job.job_id === args.jobId
        ? { ...layer, import_job: { ...layer.import_job, state: 'Cancelled' as const, progress: null } }
        : layer)
      activity.value = 'Cancelled the import without publishing.'
      result = undefined
      break
    case 'lidar_rename_layer':
      lidarLayers = lidarLayers.map(layer => layer.id === args.layerId ? { ...layer, name: String(args.name) } : layer)
      result = undefined
      break
    case 'lidar_rename_analysis':
      lidarAnalyses = lidarAnalyses.map(analysis => analysis.id === args.definitionId ? { ...analysis, name: String(args.name) } : analysis)
      result = undefined
      break
    case 'lidar_delete_layer_impact': {
      const id = String(args.layerId)
      const layer = lidarLayers.find(candidate => candidate.id === id)
      const ids = lidarAnalyses.filter(candidate => candidate.source_layer_id === id).map(candidate => candidate.id)
      result = { layer_name: layer?.name ?? id, analysis_count: ids.length, analysis_ids: ids }
      break
    }
    case 'lidar_delete_analysis': {
      const removed = lidarAnalyses.find(candidate => candidate.id === String(args.definitionId))
      lidarAnalyses = lidarAnalyses.filter(candidate => candidate !== removed)
      lidarLayers = lidarLayers.map(layer => layer.id === removed?.source_layer_id
        ? { ...layer, analysis_count: layer.analysis_count - 1 }
        : layer)
      activity.value = 'Deleted the result in memory.'
      result = undefined
      break
    }
    case 'lidar_layer_collection':
      result = {
        layer_id: String(args.layerId), head_generation_id: 'lidar-ground-g1', member_count: 4,
        sources: ['LHD_FXX_0712_6250', 'LHD_FXX_0712_6251', 'LHD_FXX_0713_6250', 'LHD_FXX_0713_6251']
          .map((stem, index) => ({
            member_id: `source-${index}`, filename: `${stem}.tif`, interpretation_id: `interp-${index}`,
            width: 2000, height: 2000, pixel_size_m: 0.5, coverage_cells: '1000000', value_range: [131.2, 287.8] as [number, number],
          })),
        next_member_cursor: null,
      }
      break
    case 'lidar_display_descriptor': {
      // The gallery serves no managed derivatives, so previews stay placeholders.
      const request = args.request as { kind: string; entity_id: string; generation_id: string | null }
      result = { kind: request.kind, entity_id: request.entity_id, generation_id: request.generation_id, profile: 'gallery', state: 'Unavailable', message: null, assets: [] }
      break
    }
    default: throw new Error(`Gallery backend has no fixture for ${command}.`)
  }
  return structuredClone(result) as T
}
