import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CanopiDesignIngestionError,
  decodeCanopiDesign,
  decodeCanopiDesignOutcome,
  placeCanopiDesignAtSite,
} from '../app/contracts/design-ingestion'
import { encodeCanopiDesign } from '../app/contracts/canopi-design-wire'
import {
  CANOPI_DESIGN_INGESTION_ERROR_KINDS,
  CURRENT_CANOPI_FILE_VERSION,
  FUTURE_CANOPI_FILE_VERSION_POLICY,
  MINIMUM_SUPPORTED_CANOPI_FILE_VERSION,
  MISSING_CANOPI_FILE_VERSION,
} from '../generated/canopi-design-format'

interface ConformanceCase {
  readonly id: string
  readonly input: unknown
  readonly accepted?: string
  readonly error_kind?: string
  /** A pre-geolocation Design is placed here before it is compared. */
  readonly site?: { readonly lon: number; readonly lat: number }
}

interface ConformanceCorpus {
  readonly contract_version: number
  readonly facts: {
    readonly current_version: number
    readonly minimum_supported_version: number
    readonly missing_version: number
    readonly future_version_policy: string
    readonly error_kinds: readonly string[]
  }
  readonly accepted_documents: Readonly<Record<string, unknown>>
  readonly cases: readonly ConformanceCase[]
}

const corpus = JSON.parse(readFileSync(
  '../../common-types/canopi-design-conformance.json',
  'utf8',
)) as ConformanceCorpus

describe('shared Canopi Design conformance corpus', () => {
  it('matches generated compatibility facts', () => {
    expect(corpus.contract_version).toBe(1)
    expect(corpus.facts).toEqual({
      current_version: CURRENT_CANOPI_FILE_VERSION,
      minimum_supported_version: MINIMUM_SUPPORTED_CANOPI_FILE_VERSION,
      missing_version: MISSING_CANOPI_FILE_VERSION,
      future_version_policy: FUTURE_CANOPI_FILE_VERSION_POLICY,
      error_kinds: CANOPI_DESIGN_INGESTION_ERROR_KINDS,
    })
  })

  it.each(corpus.cases)('$id', ({ accepted, error_kind: errorKind, input, site }) => {
    if (accepted) {
      const expected = corpus.accepted_documents[accepted]
      const inputVersion = (input as { version?: number }).version
      const outcome = decodeCanopiDesignOutcome(input)
      let decoded
      if (site) {
        if (outcome.kind !== 'needs_site') expect.fail('expected a Design that needs a site')
        expect(outcome.pending.from_version).toBe(inputVersion)
        decoded = placeCanopiDesignAtSite(outcome.pending, site)
      } else {
        if (outcome.kind !== 'design') expect.fail('the Design needs a site but the case names none')
        expect(outcome.migratedFrom).toBe(
          inputVersion === undefined || inputVersion === CURRENT_CANOPI_FILE_VERSION ? null : inputVersion,
        )
        decoded = outcome.file
      }
      expect(decoded).toEqual(expected)
      expect(decodeCanopiDesign(encodeCanopiDesign(decoded))).toEqual(expected)
      return
    }

    try {
      decodeCanopiDesign(input)
      expect.fail('expected Canopi Design ingestion to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(CanopiDesignIngestionError)
      expect((error as CanopiDesignIngestionError).kind).toBe(errorKind)
    }
  })
})
