import type { SpeciesListItem } from '../../types/species'
import { normalizeSpeciesSearch } from '../../utils/species-search-normalization'

export function secondaryCommonNameForDisplay(
  plant: SpeciesListItem,
  showMatchedCommonName: boolean,
): string | null {
  if (showMatchedCommonName) {
    const matched = distinctCommonName(plant.matched_common_name, plant.common_name, plant.common_name_2)
    if (matched) return matched
  }

  return plant.common_name_2
}

function distinctCommonName(
  candidate: string | null,
  primary: string | null,
  secondary: string | null,
): string | null {
  if (!candidate) return null

  const normalizedCandidate = normalizeCommonName(candidate)
  if (primary && normalizeCommonName(primary) === normalizedCandidate) return null
  if (secondary && normalizeCommonName(secondary) === normalizedCandidate) return null

  return candidate
}

function normalizeCommonName(value: string): string {
  return normalizeSpeciesSearch(value).text
}
