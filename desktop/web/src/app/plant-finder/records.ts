import type { PlantFinderName, PlantFinderRecord } from './matcher'

export interface PlantFinderSpecies {
  readonly canonicalName: string
  /** The name shown in the list (the interface language when the catalog has one). */
  readonly commonName?: string | null
  readonly code?: string | null
  /** Common names in the catalog's other languages and names saved with the plants. */
  readonly otherNames?: readonly (string | null | undefined)[]
  readonly synonyms?: readonly string[]
}

/** One finder record per species: every name it can be found by, deduplicated. */
export function plantFinderRecord(species: PlantFinderSpecies): PlantFinderRecord<string> {
  const names: PlantFinderName[] = []
  const seen = new Set<string>()
  const add = (text: string | null | undefined, kind: PlantFinderName['kind']) => {
    const trimmed = text?.trim()
    if (!trimmed || seen.has(`${kind}\u0000${trimmed}`)) return
    seen.add(`${kind}\u0000${trimmed}`)
    names.push({ text: trimmed, kind })
  }
  add(species.commonName, 'common')
  for (const name of species.otherNames ?? []) add(name, 'common')
  add(species.canonicalName, 'scientific')
  for (const name of species.synonyms ?? []) add(name, 'synonym')
  add(species.code, 'code')
  return { key: species.canonicalName, names }
}
