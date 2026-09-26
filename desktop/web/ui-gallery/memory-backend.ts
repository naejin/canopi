import { signal } from '@preact/signals'
import type { SavedObjectStamp } from '../src/types/saved-object-stamps'
import type {
  AnalysisOffer,
  AnalysisRequest,
  LibraryItemSummary,
  LidarImportJob,
  ProcessingRun,
  RasterQuantity,
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
const galleryTool = { engine: 'geolibre', version: 'geolibre-cli 1.5.3 (gallery)', revision: 'aac2b7439786aac2b7439786', tools: ['slope'] }
const galleryCreatedAt = String(Date.UTC(2026, 8, 12, 9, 30))

/** Offers as native computes them for slope: ground elevation that is ready. */
function galleryOffers(item: Pick<LibraryItemSummary, 'role' | 'item_type' | 'state'>): AnalysisOffer[] {
  const unavailable: AnalysisOffer['unavailable'] = item.item_type.quantity !== 'GroundElevation'
    ? { reason: 'WrongInput', expected: [{ kind: 'Raster', quantity: 'GroundElevation' }] }
    : item.state !== 'Ready' ? { reason: 'NotReady' } : null
  return [{ analysis_id: 'terrain.slope', unavailable }]
}

function gallerySource(id: string, name: string, quantity: RasterQuantity, overrides: Partial<LibraryItemSummary> = {}): LibraryItemSummary {
  const item: LibraryItemSummary = {
    id, name, role: 'Source', item_type: { kind: 'Raster', quantity }, units: 'm', state: 'Ready',
    generation_id: `${id}-g1`, bounds: lidarBounds, value_range: [131.2, 287.8],
    display_range: { min: 131.2, max: 287.8, basis: 'Exact' }, resolution_m: 0.5, coverage_cells: '4000000',
    import_job: null, provenance: null, freshness: { state: 'Current' }, run: null, offers: [], dependents: 0,
    ...overrides,
  }
  return { ...item, offers: galleryOffers(item) }
}

function gallerySlope(id: string, input: string, unit: 'degrees' | 'percent', overrides: Partial<LibraryItemSummary> = {}): LibraryItemSummary {
  const item: LibraryItemSummary = {
    id, name: null, role: 'Derived', item_type: { kind: 'Raster', quantity: 'Slope' }, units: unit === 'percent' ? '%' : '°',
    state: 'Ready', generation_id: `${id}-g1`, bounds: lidarBounds, value_range: unit === 'percent' ? [0, 89.4] : [0, 41.6],
    display_range: null, resolution_m: 0.5, coverage_cells: '3996004', import_job: null,
    provenance: {
      definition_id: `${id}-def`, analysis_id: 'terrain.slope', recipe_version: 1, output_key: 'slope',
      inputs: [{ key: 'dem', item_id: input, generation_id: `${input}-g1` }],
      parameters: [{ key: 'unit', value: { Choice: unit } }],
      tool: galleryTool, job_id: `${id}-job`, created_at: galleryCreatedAt,
    },
    freshness: { state: 'Current' }, run: { job_id: `${id}-job`, state: 'Complete', message: null }, offers: [], dependents: 0,
    ...overrides,
  }
  return { ...item, offers: galleryOffers(item) }
}

let lidarItems: LibraryItemSummary[] = state === 'empty' ? [] : [
  gallerySource('lidar-ground', state === 'long'
    ? 'IGN bare-earth elevation — La Maignannerie regional survey comparison layer'
    : 'IGN ground elevation', 'GroundElevation', { dependents: 2 }),
  gallerySlope('lidar-slope', 'lidar-ground', 'degrees'),
  gallerySlope('lidar-slope-percent', 'lidar-ground', 'percent', {
    name: 'Orchard gradient',
    freshness: { state: 'Stale', reasons: [{ reason: 'ToolUpdated', from: 'geolibre-cli 1.5.2', to: 'geolibre-cli 1.5.3' }] },
  }),
]
function galleryImport(layerId: string, name: string, quantity: RasterQuantity, job: Partial<LidarImportJob>): LibraryItemSummary {
  const failed = job.state === 'Failed'
  return gallerySource(layerId, name, quantity, {
    generation_id: null, state: failed ? 'Failed' : 'Preparing', resolution_m: null, coverage_cells: null,
    bounds: null, value_range: null, display_range: null,
    import_job: { job_id: `job-${layerId}`, layer_id: layerId, state: 'Staging', message: null, progress: { phase: 'PreparingRaster', percent: 42 }, ...job },
  })
}
if (state === 'lidar-progress') {
  lidarItems = [...lidarItems,
    galleryImport('lidar-canopy', 'Canopy height 2024', 'AboveGroundHeight', { state: 'Applying', progress: { phase: 'RenderingMap', percent: 68 } }),
    galleryImport('lidar-broken', 'Survey tile 0712', 'SurfaceElevation', { state: 'Failed', message: 'The file is not a readable raster.', progress: null }),
    gallerySlope('lidar-slope-running', 'lidar-ground', 'percent', {
      name: 'Terrace slope', generation_id: null, state: 'Preparing', value_range: null, coverage_cells: null,
      run: { job_id: 'lidar-slope-running-job', state: 'Preparing', message: null },
    }),
  ]
}
const galleryRuns = new Map<string, ProcessingRun[]>()
function recordRun(item: LibraryItemSummary, at = String(Date.now())): void {
  const provenance = item.provenance!
  galleryRuns.set(provenance.definition_id, [{
    job_id: `job-${sequence++}`, state: 'Complete', message: null, recipe_version: provenance.recipe_version, tool: galleryTool,
    inputs: provenance.inputs, created_at: at, finished_at: at,
    outputs: [{ item_id: item.id, generation_id: item.generation_id ?? '', coverage_cells: item.coverage_cells }],
  }, ...(galleryRuns.get(provenance.definition_id) ?? [])])
}
for (const item of lidarItems) {
  if (item.provenance && item.generation_id) recordRun(item, galleryCreatedAt)
}
function updateItem(id: unknown, change: (item: LibraryItemSummary) => LibraryItemSummary): void {
  lidarItems = lidarItems.map(item => item.id === id ? change(item) : item)
}
export const activity = signal('All changes stay in memory. Reload to reset.')
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()
// Start-screen fixtures: dated relative to now so Today and Yesterday read naturally.
function recentDesigns() {
  return [
    { path: '/designs/sanctuaire.canopi', name: "Le Sanctuaire d'Aylin – Verger Syntropique", updated_at: hoursAgo(1), plant_count: 2201 },
    { path: '/designs/haie-nord.canopi', name: 'Haie fruitière nord', updated_at: hoursAgo(26), plant_count: 64 },
    { path: '/designs/mare.canopi', name: 'Jardin de la mare', updated_at: hoursAgo(24 * 14), plant_count: 180 },
  ]
}
let drafts = [
  { id: 'draft-untitled', name: 'Untitled', updated_at: hoursAgo(24 * 3) },
  { id: 'draft-haie-sud', name: 'Haie sud, essai', updated_at: hoursAgo(24 * 5) },
]
export function convertFileSrc(path: string) { return path }
export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const canonicalName = String(args.canonicalName ?? '')
  const plant = species.find(plant => plant.canonical_name === canonicalName) ?? species[0]!
  let result: unknown
  switch (command) {
    case 'get_favorites': result = species.filter(plant => favoriteNames.has(plant.canonical_name)).map(plant => ({ ...plant, common_name: state === 'long' ? plant.common_name + ' — a particularly long local cultivar name' : plant.common_name })); break
    case 'get_recently_viewed': result = []; break
    case 'get_recent_files': result = recentDesigns(); break
    case 'list_design_drafts': result = drafts; break
    case 'delete_design_draft':
      drafts = drafts.filter(draft => draft.id !== args.id)
      activity.value = 'Deleted the draft in memory.'; result = undefined; break
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
        items: lidarItems,
        engines: {
          gdal: { available: true, version: '3.8.4', detail: null },
          geolibre: { available: true, version: galleryTool.version, detail: null },
        },
      }; break
    case 'lidar_create_analysis': {
      const request = args.request as AnalysisRequest
      const input = request.inputs[0]?.item_id ?? ''
      const unit = request.parameters.find(parameter => parameter.key === 'unit')?.value
      const id = `lidar-analysis-${sequence++}`
      const item = gallerySlope(id, input, unit && 'Choice' in unit && unit.Choice === 'percent' ? 'percent' : 'degrees', { name: request.name })
      lidarItems = [...lidarItems, item]
      updateItem(input, source => ({ ...source, dependents: source.dependents + 1 }))
      recordRun(item)
      activity.value = 'Calculated a slope result in memory.'
      result = { definition_id: item.provenance!.definition_id, job_id: item.provenance!.job_id, item_ids: [id] }
      break
    }
    case 'lidar_rerun_analysis': {
      const item = lidarItems.find(candidate => candidate.provenance?.definition_id === args.definitionId)
      if (item) {
        const refreshed = { ...item, state: 'Ready' as const, generation_id: `${item.id}-g${sequence++}`, freshness: { state: 'Current' as const } }
        updateItem(item.id, () => refreshed)
        recordRun(refreshed)
      }
      activity.value = 'Refreshed the result in memory.'
      result = { definition_id: String(args.definitionId), job_id: `job-${sequence++}`, item_ids: item ? [item.id] : [] }
      break
    }
    case 'lidar_processing_history':
      result = { definition_id: String(args.definitionId), runs: galleryRuns.get(String(args.definitionId)) ?? [], next_cursor: null }
      break
    case 'lidar_cancel_analysis_job':
      lidarItems = lidarItems.map((item): LibraryItemSummary => item.run && item.run.job_id === args.jobId && item.run.state === 'Preparing'
        ? { ...item, state: item.generation_id ? 'Ready' : 'Failed', run: { ...item.run, state: 'Cancelled' } }
        : item)
      activity.value = 'Cancelled the calculation without publishing.'
      result = undefined
      break
    case 'lidar_import_item': {
      const id = `lidar-layer-${sequence++}`
      lidarItems = [...lidarItems, galleryImport(id, String(args.name), args.quantity as RasterQuantity, {})]
      activity.value = 'Started a library import in memory.'
      result = { layer_id: id, job_id: `job-${id}` }
      break
    }
    case 'lidar_retry_import':
      updateItem(args.layerId, item => item.import_job
        ? { ...item, state: 'Preparing', import_job: { ...item.import_job, state: 'Staging', message: null, progress: { phase: 'PreparingRaster', percent: 5 } } }
        : item)
      activity.value = 'Retried the import in memory.'
      result = { layer_id: String(args.layerId), job_id: `job-${String(args.layerId)}` }
      break
    case 'lidar_dismiss_import':
      lidarItems = lidarItems.filter(candidate => candidate.id !== args.layerId)
      activity.value = 'Removed the library item in memory.'
      result = undefined
      break
    case 'lidar_delete_item': {
      const removed = lidarItems.find(candidate => candidate.id === args.itemId)
      if (removed && removed.dependents > 0) throw new Error('Other results were calculated from this data.')
      lidarItems = lidarItems.filter(candidate => candidate !== removed)
      const input = removed?.provenance?.inputs[0]?.item_id
      if (input) updateItem(input, source => ({ ...source, dependents: Math.max(0, source.dependents - 1) }))
      activity.value = 'Deleted the library item in memory.'
      result = undefined
      break
    }
    case 'lidar_cancel_import':
      lidarItems = lidarItems.map(item => item.import_job && item.import_job.job_id === args.jobId
        ? { ...item, state: 'Failed' as const, import_job: { ...item.import_job, state: 'Cancelled' as const, progress: null } }
        : item)
      activity.value = 'Cancelled the import without publishing.'
      result = undefined
      break
    case 'lidar_rename_item':
      updateItem(args.itemId, item => ({ ...item, name: String(args.name) }))
      result = undefined
      break
    case 'lidar_delete_impact':
      result = {
        dependent_item_ids: lidarItems
          .filter(candidate => candidate.provenance?.inputs.some(input => input.item_id === args.itemId))
          .map(candidate => candidate.id),
      }
      break
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
