import { describe, expect, it } from 'vitest'
import {
  SPECIES_SEARCH_NORMALIZATION_CORPUS,
  SPECIES_SEARCH_NORMALIZATION_VERSION,
} from '../generated/species-search-normalization'
import {
  normalizeSpeciesSearch,
  speciesSearchAdmission,
} from '../utils/species-search-normalization'

describe('Species Search normalization', () => {
  it('matches the authored cross-runtime corpus', () => {
    expect(SPECIES_SEARCH_NORMALIZATION_VERSION).toBe(1)

    for (const testCase of SPECIES_SEARCH_NORMALIZATION_CORPUS) {
      const normalized = normalizeSpeciesSearch(testCase.input)
      expect(normalized.text, `${testCase.name} text`).toBe(testCase.normalizedText)
      expect(normalized.tokens, `${testCase.name} tokens`).toEqual(testCase.tokens)
      expect(speciesSearchAdmission(testCase.input), `${testCase.name} admission`)
        .toBe(testCase.admission)
    }
  })
})
