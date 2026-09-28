import type { PrintBounds } from '../../canvas/print'
import { findPlants, type PlantFinderHit } from '../plant-finder/matcher'
import { plantFinderRecord } from '../plant-finder/records'
import type { PdfLegendEntry, PdfPlan } from './types'

/**
 * Find in the PDF key: where each species entry is printed (the page and the entry's
 * box, from the key's own link destinations) and the plant finder's matcher over the
 * printed names, scientific names and codes. A species keyed on several sheets has one
 * location per sheet.
 */
export interface PdfKeyLocation {
  readonly pageId: string
  readonly pageNumber: number
  /** The sheet the key belongs to: the page itself, or the sheet a key page continues. */
  readonly sourceId: string
  readonly entry: PdfLegendEntry
  readonly bounds: PrintBounds
}

interface PdfKeyResult {
  readonly location: PdfKeyLocation
  readonly hit: PlantFinderHit<string>
}

export interface PdfKeySearch {
  readonly active: boolean
  readonly correction: string | null
  /** Best match first; one species' sheets in page order. */
  readonly results: readonly PdfKeyResult[]
  readonly speciesCount: number
}

export function pdfKeyLocations(plan: PdfPlan | undefined): PdfKeyLocation[] {
  const locations: PdfKeyLocation[] = []
  for (const page of plan?.pages ?? []) {
    const sourceId = page.kind === 'legend' ? page.sourceId ?? page.id : page.id
    for (const entry of page.legend) {
      if (entry.reference === undefined) continue
      const destination = page.destinations?.find((candidate) => candidate.id === `${sourceId}:key:${entry.reference}`)
      if (destination?.bounds) locations.push({ pageId: page.id, pageNumber: page.number, sourceId, entry, bounds: destination.bounds })
    }
  }
  return locations
}

export function findInPdfKey(locations: readonly PdfKeyLocation[], query: string): PdfKeySearch {
  const bySpecies = new Map<string, PdfKeyLocation[]>()
  for (const location of locations) {
    const entries = bySpecies.get(location.entry.canonicalName) ?? []
    entries.push(location)
    bySpecies.set(location.entry.canonicalName, entries)
  }
  const records = [...bySpecies.values()].map(([first]) => plantFinderRecord({
    canonicalName: first!.entry.canonicalName,
    commonName: first!.entry.name === first!.entry.canonicalName ? null : first!.entry.name,
    code: first!.entry.code,
  }))
  const found = findPlants(records, query)
  return {
    active: found.active,
    correction: found.correction,
    results: found.hits.flatMap((hit) => bySpecies.get(hit.key)!.map((location) => ({ location, hit }))),
    speciesCount: found.hits.length,
  }
}
