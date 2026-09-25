import type {
  LidarAnalysisMethod,
  LidarImportJob,
  LidarLibrarySnapshot,
  LidarMeasurementKind,
  LidarPresentationEntryKind,
  LidarSlopeUnit,
} from '../../generated/contracts'

/**
 * One reusable Data Library item: an imported source or a saved result.
 *
 * Both come from the library snapshot, which remains the only authority; this
 * is a read model for the dock, and search, filter and order are session view
 * state, never Design data.
 */
export interface LibraryItem {
  readonly kind: LidarPresentationEntryKind
  readonly id: string
  readonly name: string
  /** Measurement kind of a source; `Slope` for a result. */
  readonly type: LidarMeasurementKind | 'Slope'
  readonly status: 'ready' | 'preparing' | 'failed'
  readonly generationId: string | null
  readonly units: string
  readonly resolutionM: number | null
  readonly bounds: readonly [number, number, number, number] | null
  readonly displayRange: readonly [number, number] | null
  readonly slopeUnit: LidarSlopeUnit | null
  /** The import operation of an unpublished source. */
  readonly importJob: LidarImportJob | null
  /** A result's input source item and generation. */
  readonly sourceLayerId: string | null
  readonly inputGenerationId: string | null
  /** A source's saved results. */
  readonly resultCount: number
  readonly message: string | null
  /** A result's method, from its recipe; null for a source or an unknown recipe. */
  readonly method: LidarAnalysisMethod | null
  /** The engine build that produced a result, as recorded when it was published. */
  readonly engineVersion: string | null
}

export type LibraryTypeFilter = 'all' | 'sources' | 'slope'

export function libraryItems(snapshot: LidarLibrarySnapshot | null, slopeLabel = 'Slope'): LibraryItem[] {
  if (!snapshot) return []
  const items: LibraryItem[] = []
  for (const layer of snapshot.layers) {
    const job = layer.import_job ?? null
    const running = job?.state === 'Staging' || job?.state === 'Applying'
    items.push({
      kind: 'Source',
      id: layer.id,
      name: layer.name,
      type: layer.measurement_kind,
      status: layer.generation_id ? 'ready' : running ? 'preparing' : 'failed',
      generationId: layer.generation_id ?? null,
      units: layer.units,
      resolutionM: layer.resolution_m ?? null,
      bounds: layer.bounds ?? null,
      displayRange: layer.display_range
        ? [layer.display_range.min, layer.display_range.max]
        : layer.value_range ?? null,
      slopeUnit: null,
      importJob: layer.generation_id ? null : job,
      sourceLayerId: null,
      inputGenerationId: null,
      resultCount: layer.analysis_count,
      message: layer.generation_id ? null : job?.message ?? null,
      method: null,
      engineVersion: null,
    })
  }
  for (const analysis of snapshot.analyses) {
    const source = snapshot.layers.find((layer) => layer.id === analysis.source_layer_id)
    const unit = analysis.slope_unit
    items.push({
      kind: 'Analysis',
      id: analysis.id,
      name: analysis.name ?? (source ? `${source.name} · ${slopeLabel}` : slopeLabel),
      type: 'Slope',
      status: analysis.generation_id
        ? 'ready'
        : analysis.state === 'Preparing' ? 'preparing' : 'failed',
      generationId: analysis.generation_id ?? null,
      units: unit === 'Percent' ? '%' : '°',
      resolutionM: source?.resolution_m ?? null,
      bounds: analysis.bounds ?? null,
      displayRange: analysis.value_range ?? null,
      slopeUnit: unit,
      importJob: null,
      sourceLayerId: analysis.source_layer_id,
      inputGenerationId: analysis.input_generation_id ?? null,
      resultCount: 0,
      message: analysis.detail ?? null,
      method: analysis.method ?? null,
      engineVersion: analysis.engine_version ?? null,
    })
  }
  // Stable name order, identity as the tie-breaker: names are not unique.
  return items.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    || left.id.localeCompare(right.id))
}

/**
 * Items matching a name search and type filter. Operations in progress or
 * failed stay listed whatever the filter, so an import started here is never
 * hidden before it settles.
 */
export function filterLibraryItems(
  items: readonly LibraryItem[],
  query: string,
  type: LibraryTypeFilter,
  relatedTo: string | null = null,
): LibraryItem[] {
  const needle = query.trim().toLocaleLowerCase()
  return items.filter((item) => {
    if (item.status !== 'ready' && item.kind === 'Source') return true
    if (relatedTo !== null) return item.sourceLayerId === relatedTo
    if (type === 'sources' && item.kind !== 'Source') return false
    if (type === 'slope' && item.kind !== 'Analysis') return false
    return needle === '' || item.name.toLocaleLowerCase().includes(needle)
  })
}

/** A default item name from the chosen files: their shared stem, or the first. */
export function suggestedItemName(paths: readonly string[]): string {
  const names = paths.map((path) => (path.split(/[\\/]/).pop() ?? path).replace(/\.(tiff?|asc|img|vrt)$/i, ''))
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  let prefix = names[0]!
  for (const name of names.slice(1)) {
    while (prefix && !name.startsWith(prefix)) prefix = prefix.slice(0, -1)
  }
  const trimmed = prefix.replace(/[\s_\-.]+$/, '')
  return trimmed.length >= 3 ? trimmed : names[0]!
}

/** Why slope cannot be calculated from this item, or null when it can. */
export type SlopeIneligibility = 'notSource' | 'notReady' | 'notGround' | 'notMetres' | 'engine'

export function slopeIneligibility(
  item: LibraryItem,
  engineAvailable: boolean,
): SlopeIneligibility | null {
  if (item.kind !== 'Source') return 'notSource'
  if (item.status !== 'ready') return 'notReady'
  if (item.type !== 'GroundElevation') return 'notGround'
  if (!/^(m|metres?|meters?)$/i.test(item.units.trim())) return 'notMetres'
  if (!engineAvailable) return 'engine'
  return null
}
