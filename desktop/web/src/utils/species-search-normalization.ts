import {
  SPECIES_SEARCH_CASE_FOLDS,
  SPECIES_SEARCH_COMPATIBILITY_DECOMPOSITION_MAPPINGS,
  SPECIES_SEARCH_HANGUL_DECOMPOSITION,
  SPECIES_SEARCH_KNOWN_SCALAR_RANGES,
  SPECIES_SEARCH_LOWERCASE_MAPPINGS,
  SPECIES_SEARCH_MARK_SCALAR_RANGES,
  SPECIES_SEARCH_MINIMUM_ADMITTED_SCALAR_COUNT,
  SPECIES_SEARCH_TOKEN_SCALAR_RANGES,
  type SpeciesSearchAdmission,
} from '../generated/species-search-normalization'

export interface NormalizedSpeciesSearch {
  readonly text: string
  readonly tokens: readonly string[]
  readonly scalarCount: number
}

const LOWERCASE_BY_SCALAR = new Map<number, string>(SPECIES_SEARCH_LOWERCASE_MAPPINGS)
const DECOMPOSITION_BY_SCALAR = new Map<number, string>(
  SPECIES_SEARCH_COMPATIBILITY_DECOMPOSITION_MAPPINGS,
)

function scalarInRanges(
  ranges: readonly (readonly [number, number])[],
  scalar: number,
): boolean {
  let low = 0
  let high = ranges.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const range = ranges[middle]!
    if (range[1] < scalar) low = middle + 1
    else high = middle
  }
  const range = ranges[low]
  return range !== undefined && range[0] <= scalar && scalar <= range[1]
}

function decomposeScalar(scalar: number, character: string): string {
  const mapped = DECOMPOSITION_BY_SCALAR.get(scalar)
  if (mapped !== undefined) return mapped

  const hangul = SPECIES_SEARCH_HANGUL_DECOMPOSITION
  const hangulScalarCount = hangul.lCount * hangul.vCount * hangul.tCount
  const hangulIndex = scalar - hangul.sBase
  if (hangulIndex < 0 || hangulIndex >= hangulScalarCount) return character

  const trailingIndex = hangulIndex % hangul.tCount
  const vowelIndex = Math.floor(hangulIndex / hangul.tCount) % hangul.vCount
  const leadingIndex = Math.floor(hangulIndex / (hangul.vCount * hangul.tCount))
  return String.fromCodePoint(
    hangul.lBase + leadingIndex,
    hangul.vBase + vowelIndex,
    ...(trailingIndex === 0 ? [] : [hangul.tBase + trailingIndex]),
  )
}

export function normalizeSpeciesSearch(raw: string): NormalizedSpeciesSearch {
  const decomposed = Array.from(raw, (character) => {
    const scalar = character.codePointAt(0)!
    return scalarInRanges(SPECIES_SEARCH_KNOWN_SCALAR_RANGES, scalar)
      ? decomposeScalar(scalar, character)
      : ' '
  }).join('')
  let folded = Array.from(decomposed, (character) => {
    const scalar = character.codePointAt(0)!
    if (scalarInRanges(SPECIES_SEARCH_MARK_SCALAR_RANGES, scalar)) return ''
    return LOWERCASE_BY_SCALAR.get(scalar) ?? character
  }).join('')
  for (const replacement of SPECIES_SEARCH_CASE_FOLDS) {
    folded = folded.split(replacement.from).join(replacement.to)
  }

  const tokens: string[] = []
  let token = ''
  for (const character of folded) {
    const scalar = character.codePointAt(0)!
    if (
      character === '_'
      || scalarInRanges(SPECIES_SEARCH_TOKEN_SCALAR_RANGES, scalar)
    ) {
      token += character
    } else if (token) {
      tokens.push(token)
      token = ''
    }
  }
  if (token) tokens.push(token)
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
