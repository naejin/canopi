import { useMemo } from 'preact/hooks'
import { currentCanvasQuerySurface, currentCanvasSelection } from '../../canvas/session'
import type { CanvasQuerySurface } from '../../canvas/runtime/runtime'

/**
 * What is selected on the map, for the selection status chip: counts by kind,
 * the species of the selected plants and the names of the selected zones.
 * Read through read-only runtime queries; groups count as their members.
 */
export interface MapSelectionSummary {
  readonly plantCount: number
  /** Selected plants per species, in Design order. */
  readonly species: readonly MapSelectionSpecies[]
  readonly zoneNames: readonly string[]
  readonly noteCount: number
  readonly measurementCount: number
}

export interface MapSelectionSpecies {
  readonly canonicalName: string
  /** The common name in the current language, else the Design's, else the scientific name. */
  readonly name: string
  readonly selectedCount: number
  /** Every plant of this species in the Design. */
  readonly designCount: number
}

/** Follows the canvas selection; null when nothing is selected. */
export function useMapSelectionSummary(): MapSelectionSummary | null {
  const queries = currentCanvasQuerySurface.value
  const selection = currentCanvasSelection.value
  const sceneRevision = queries?.revision.scene.value
  const namesRevision = queries?.revision.plantNames.value
  return useMemo(
    () => readMapSelectionSummary(queries),
    [queries, selection, sceneRevision, namesRevision],
  )
}

export function readMapSelectionSummary(queries: CanvasQuerySurface | null): MapSelectionSummary | null {
  const selection = queries?.getSelection() ?? []
  if (!queries || selection.length === 0) return null
  const scene = queries.getSceneSnapshot()
  const plantIds = new Set<string>()
  const zoneNames = new Set<string>()
  const noteIds = new Set<string>()
  const measurementIds = new Set<string>()
  const add = (kind: string, id: string) => {
    if (kind === 'plant') plantIds.add(id)
    else if (kind === 'zone') zoneNames.add(id)
    else if (kind === 'annotation') noteIds.add(id)
    else if (kind === 'measurement-guide') measurementIds.add(id)
  }
  for (const target of selection) {
    if (target.kind !== 'group') {
      add(target.kind, target.id)
      continue
    }
    for (const member of scene.groups.find((group) => group.id === target.id)?.members ?? []) add(member.kind, member.id)
  }

  const counts = new Map<string, { selected: number; design: number; commonName: string | null }>()
  let plantCount = 0
  for (const plant of scene.plants) {
    let entry = counts.get(plant.canonicalName)
    if (!entry) {
      entry = { selected: 0, design: 0, commonName: null }
      counts.set(plant.canonicalName, entry)
    }
    entry.design += 1
    if (!plantIds.has(plant.id)) continue
    entry.selected += 1
    entry.commonName ??= plant.commonName
    plantCount += 1
  }
  const localized = queries.getLocalizedCommonNames()
  const species: MapSelectionSpecies[] = []
  for (const [canonicalName, entry] of counts) {
    if (entry.selected === 0) continue
    species.push({
      canonicalName,
      name: localized.get(canonicalName) || entry.commonName || canonicalName,
      selectedCount: entry.selected,
      designCount: entry.design,
    })
  }

  const zones = scene.zones.filter((zone) => zoneNames.has(zone.name)).map((zone) => zone.name)
  const noteCount = scene.annotations.filter((note) => noteIds.has(note.id)).length
  const measurementCount = scene.measurementGuides.filter((guide) => measurementIds.has(guide.id)).length
  if (plantCount + zones.length + noteCount + measurementCount === 0) return null
  return { plantCount, species, zoneNames: zones, noteCount, measurementCount }
}
