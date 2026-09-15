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
  tilesets: [{
    style: 'elevation',
    path_template: '/lidar-prototype/assets/mnt-elevation-{z}.png',
    min_zoom: 13,
    max_zoom: 17,
    tile_size: 256,
    bounds: lidarBounds,
  }],
  analysis_count: 1,
}]
let lidarAnalyses: LidarAnalysisSummary[] = state === 'empty' ? [] : [{
  id: 'lidar-slope',
  source_layer_id: 'lidar-ground',
  kind: 'Slope',
  state: 'Ready',
  detail: null,
  bounds: lidarBounds,
  value_range: [0, 41.6],
  tilesets: [{
    style: 'slope',
    path_template: '/lidar-prototype/assets/mnt-hillshade-{z}.png',
    min_zoom: 13,
    max_zoom: 17,
    tile_size: 256,
    bounds: lidarBounds,
  }],
}]
function createGalleryLidarReview(layerId: string): LidarImportJob {
  return {
    job_id: 'gallery-import',
    layer_id: layerId,
    state: 'AwaitingReview',
    message: null,
    review: {
      job_id: 'gallery-import',
      layer_id: layerId,
      sources: [{
        filename: state === 'long' || state === 'lidar-review'
          ? 'LHD_FXX_0446_6807_MNT_O_0M50_LAMB93_IGN69_without_extension'
          : 'IGN_0446_6807',
        sha256: 'gallery-sha256',
        size_bytes: '16000000',
        width: 2000,
        height: 2000,
        pixel_size_m: 0.5,
        nodata: -9999,
        value_range: [131.2, 287.8],
        compatible: true,
        issues: [],
      }],
      uncovered_cells: '3125000',
      overlap_cells: '875000',
      invalid_cells: '0',
      compatible: true,
      issues: [],
      before_preview_path: '/lidar-prototype/assets/mnt-elevation-0.png',
      after_preview_path: '/lidar-prototype/assets/mnt-elevation-1.png',
    },
  }
}

let lidarImportJob: LidarImportJob | null = state === 'lidar-review'
  ? createGalleryLidarReview('lidar-ground')
  : null
export const galleryInitialLidarImportJob = lidarImportJob
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
      }; break
    case 'lidar_create_layer': {
      const id = `lidar-layer-${sequence++}`
      lidarLayers = [...lidarLayers, {
        id,
        name: String(args.name),
        measurement_kind: 'GroundElevation',
        units: 'm',
        state: 'Preparing',
        resolution_m: null,
        coverage_cells: '0',
        bounds: null,
        value_range: null,
        tilesets: [],
        analysis_count: 0,
      }]
      activity.value = 'Created a ground layer in memory.'
      result = id
      break
    }
    case 'lidar_delete_layer_impact': {
      const id = String(args.layerId)
      const layer = lidarLayers.find(candidate => candidate.id === id)
      const ids = lidarAnalyses.filter(candidate => candidate.source_layer_id === id).map(candidate => candidate.id)
      result = { layer_name: layer?.name ?? id, analysis_count: ids.length, analysis_ids: ids }
      break
    }
    case 'lidar_delete_layer': {
      const id = String(args.layerId)
      lidarLayers = lidarLayers.filter(candidate => candidate.id !== id)
      lidarAnalyses = lidarAnalyses.filter(candidate => candidate.source_layer_id !== id)
      activity.value = 'Deleted the LiDAR layer in memory.'
      result = undefined
      break
    }
    case 'lidar_delete_analysis':
      lidarAnalyses = lidarAnalyses.filter(candidate => candidate.id !== String(args.definitionId))
      activity.value = 'Deleted the analysis in memory.'
      result = undefined
      break
    case 'lidar_stage_import':
      lidarImportJob = createGalleryLidarReview(String(args.layerId))
      activity.value = 'Staged the sample raster in memory.'
      result = lidarImportJob.job_id
      break
    case 'lidar_get_import_job': result = lidarImportJob; break
    case 'lidar_preview_import_decision':
      result = {
        add_uncovered: Boolean(args.addUncovered),
        replace_overlap: Boolean(args.replaceOverlap),
        before_preview_path: '/lidar-prototype/assets/mnt-elevation-0.png',
        after_preview_path: '/lidar-prototype/assets/mnt-elevation-1.png',
      }
      break
    case 'lidar_apply_import':
      if (lidarImportJob) lidarImportJob = { ...lidarImportJob, state: 'Complete', message: 'Published 4,000,000 cells.' }
      activity.value = 'Applied the LiDAR import in memory.'
      result = undefined
      break
    case 'lidar_cancel_import':
      if (lidarImportJob) lidarImportJob = { ...lidarImportJob, state: 'Cancelled', message: null }
      activity.value = 'Cancelled the LiDAR import without publishing.'
      result = undefined
      break
    case 'lidar_create_analysis': {
      const layerId = String(args.layerId)
      const definitionId = `lidar-analysis-${sequence++}`
      lidarAnalyses = [...lidarAnalyses, {
        id: definitionId,
        source_layer_id: layerId,
        kind: 'Slope',
        state: 'Ready',
        detail: null,
        bounds: lidarBounds,
        value_range: [0, 41.6],
        tilesets: [],
      }]
      lidarLayers = lidarLayers.map(layer => layer.id === layerId
        ? { ...layer, analysis_count: layer.analysis_count + 1 }
        : layer)
      activity.value = 'Created a slope analysis in memory.'
      result = { definition_id: definitionId, job_id: `job-${definitionId}` }
      break
    }
    case 'lidar_layer_history':
      result = [{
        id: 'gallery-generation',
        created_at: file.created_at,
        coverage_cells: '4000000',
        members: ['gallery-sha256'],
        roles: ['add'],
        job_ids: ['gallery-import'],
        is_head: true,
      }]; break
    case 'lidar_undo_import':
      activity.value = 'Republished the layer without the selected import in memory.'
      result = undefined
      break
    default: throw new Error(`Gallery backend has no fixture for ${command}.`)
  }
  return structuredClone(result) as T
}
