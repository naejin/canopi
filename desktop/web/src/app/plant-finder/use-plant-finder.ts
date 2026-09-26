import { useMemo } from 'preact/hooks'
import { useCatalogNamesInEveryLanguage } from './catalog-names'
import { findPlants, type PlantFinderResult } from './matcher'
import { plantFinderRecord, type PlantFinderSpecies } from './records'

/** Matches a list's species by every name the catalog knows for them. */
export function usePlantFinder(
  species: readonly PlantFinderSpecies[],
  query: string,
): PlantFinderResult<string> {
  const catalogNames = useCatalogNamesInEveryLanguage(species.map((entry) => entry.canonicalName))
  const records = useMemo(() => species.map((entry) => plantFinderRecord({
    ...entry,
    otherNames: [...(entry.otherNames ?? []), ...catalogNames(entry.canonicalName)],
  })), [species, catalogNames])
  return useMemo(() => findPlants(records, query), [records, query])
}
