import {
  SPECIES_SEARCH_CASE_FOLDS,
  SPECIES_SEARCH_MINIMUM_ADMITTED_SCALAR_COUNT,
  type SpeciesSearchAdmission,
} from '../generated/species-search-normalization'

export interface NormalizedSpeciesSearch {
  readonly text: string
  readonly tokens: readonly string[]
  readonly scalarCount: number
}

const TOKEN_PATTERN = /[\p{Letter}\p{Number}_]+/gu
const MARK_PATTERN = /\p{Mark}/gu

export function normalizeSpeciesSearch(raw: string): NormalizedSpeciesSearch {
  let folded = raw
    .normalize('NFKD')
    .replace(MARK_PATTERN, '')
    .toLowerCase()
  for (const replacement of SPECIES_SEARCH_CASE_FOLDS) {
    folded = folded.split(replacement.from).join(replacement.to)
  }

  const tokens = folded.match(TOKEN_PATTERN) ?? []
  return {
    text: tokens.join(' '),
    tokens,
    scalarCount: tokens.reduce(
      (count, token) => count + Array.from(token).length,
      0,
    ),
  }
}

export function speciesSearchAdmission(raw: string): SpeciesSearchAdmission {
  const { scalarCount } = normalizeSpeciesSearch(raw)
  if (scalarCount === 0) return 'browse'
  if (scalarCount < SPECIES_SEARCH_MINIMUM_ADMITTED_SCALAR_COUNT) return 'too-short'
  return 'active-text'
}

export function speciesSearchQueryTokens(raw: string): readonly string[] {
  const normalized = normalizeSpeciesSearch(raw)
  if (normalized.scalarCount < SPECIES_SEARCH_MINIMUM_ADMITTED_SCALAR_COUNT) return []

  const uniqueTokens = [...new Set(normalized.tokens)]
  const admittedTokens = uniqueTokens.filter(
    (token) => Array.from(token).length >= SPECIES_SEARCH_MINIMUM_ADMITTED_SCALAR_COUNT,
  )
  return admittedTokens.length > 0 ? admittedTokens : uniqueTokens
}
