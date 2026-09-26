import type { AnalysisGroup } from '../../generated/analysis-registry'
import type {
  AnalysisOffer,
  AnalysisRunStatus,
  Freshness,
  LibraryItemRole,
  LibraryItemType,
  LibrarySnapshot,
  LidarImportJob,
  Provenance,
} from '../../generated/contracts'
import { analysisGroup } from '../analyses/registry'
import { itemDisplayRange, libraryItemName } from './library-store'

/**
 * One reusable Data Library item: an imported source or a derived result.
 *
 * Both come from the library snapshot, which remains the only authority; this
 * is a read model for the dock, and search, filter and order are session view
 * state, never Design data.
 */
export interface LibraryItem {
  readonly role: LibraryItemRole
  readonly id: string
  readonly name: string
  readonly itemType: LibraryItemType
  readonly status: 'ready' | 'preparing' | 'failed'
  readonly generationId: string | null
  readonly units: string
  readonly resolutionM: number | null
  readonly bounds: readonly [number, number, number, number] | null
  readonly displayRange: readonly [number, number] | null
  /** The import operation of an unpublished source. */
  readonly importJob: LidarImportJob | null
  /** What produced a derived item; null for a source. */
  readonly provenance: Provenance | null
  readonly freshness: Freshness
  /** The latest run of a derived item: first calculation, retry or refresh. */
  readonly run: AnalysisRunStatus | null
  readonly offers: readonly AnalysisOffer[]
  /** Derived items calculated from this one. */
  readonly dependents: number
  /** The item a derived row nests under: its first input. */
  readonly parentId: string | null
  /** The registry group of the analysis that produced a derived item. */
  readonly group: AnalysisGroup | null
  /** Nesting depth in the list: 0 for a top-level row. */
  readonly depth: number
  readonly message: string | null
}

/** All, sources, or the derived items of one registry group. */
export type LibraryTypeFilter = 'all' | 'sources' | AnalysisGroup

/**
 * Library items in list order: top-level rows by name, each followed by the
 * derived items calculated from it, nested under their first input.
 */
export function libraryItems(snapshot: LibrarySnapshot | null): LibraryItem[] {
  if (!snapshot) return []
  const items = snapshot.items.map((summary): Omit<LibraryItem, 'depth'> => {
    const job = summary.import_job ?? null
    const published = summary.generation_id !== null
    return {
      role: summary.role,
      id: summary.id,
      name: libraryItemName(summary, snapshot),
      itemType: summary.item_type,
      status: summary.state === 'Ready' ? 'ready' : summary.state === 'Preparing' ? 'preparing' : 'failed',
      generationId: summary.generation_id ?? null,
      units: summary.units,
      resolutionM: summary.resolution_m ?? null,
      bounds: summary.bounds ?? null,
      displayRange: itemDisplayRange(summary),
      importJob: published ? null : job,
      provenance: summary.provenance,
      freshness: summary.freshness,
      run: summary.run,
      offers: summary.offers,
      dependents: summary.dependents,
      parentId: summary.provenance?.inputs[0]?.item_id ?? null,
      group: summary.provenance ? analysisGroup(summary.provenance.analysis_id) : null,
      message: summary.role === 'Source'
        ? (published ? null : job?.message ?? null)
        : summary.run?.message ?? null,
    }
  })
  const ids = new Set(items.map((item) => item.id))
  const children = new Map<string | null, Omit<LibraryItem, 'depth'>[]>()
  for (const item of items) {
    const parent = item.parentId !== null && item.parentId !== item.id && ids.has(item.parentId) ? item.parentId : null
    children.set(parent, [...(children.get(parent) ?? []), item])
  }
  const ordered: LibraryItem[] = []
  const visited = new Set<string>()
  const visit = (parent: string | null, depth: number) => {
    // Stable name order, identity as the tie-breaker: names are not unique.
    const rows = [...(children.get(parent) ?? [])].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
      || left.id.localeCompare(right.id))
    for (const row of rows) {
      if (visited.has(row.id)) continue
      visited.add(row.id)
      ordered.push({ ...row, depth })
      visit(row.id, depth + 1)
    }
  }
  visit(null, 0)
  // A cycle has no root; list whatever it left out at the top level.
  for (const item of items) {
    if (!visited.has(item.id)) ordered.push({ ...item, depth: 0 })
  }
  return ordered
}

/**
 * Items matching a name search and type filter. Operations in progress or
 * failed stay listed whatever the filter, so an import or calculation started
 * here is never hidden before it settles.
 */
export function filterLibraryItems(
  items: readonly LibraryItem[],
  query: string,
  type: LibraryTypeFilter,
  relatedTo: string | null = null,
): LibraryItem[] {
  const needle = query.trim().toLocaleLowerCase()
  return items.filter((item) => {
    if (item.status !== 'ready') return true
    if (relatedTo !== null) return item.provenance?.inputs.some((input) => input.item_id === relatedTo) ?? false
    if (type === 'sources' && item.role !== 'Source') return false
    if (type !== 'all' && type !== 'sources' && item.group !== type) return false
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
