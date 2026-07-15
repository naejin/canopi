import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CanopiDesignIngestionError,
  decodeCanopiDesign,
} from '../app/contracts/design-ingestion'
import {
  CANOPI_DESIGN_INGESTION_ERROR_KINDS,
  CURRENT_CANOPI_FILE_VERSION,
  FUTURE_CANOPI_FILE_VERSION_POLICY,
  MIN_SUPPORTED_CANOPI_FILE_VERSION,
  MISSING_CANOPI_FILE_VERSION,
} from '../generated/canopi-design-format'

interface ConformanceCase {
  readonly id: string
  readonly input: unknown
  readonly accepted?: string
  readonly error_kind?: string
}

interface ConformanceCorpus {
  readonly contract_version: number
  readonly facts: {
    readonly current_version: number
    readonly missing_version: number
    readonly minimum_supported_version: number
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
      missing_version: MISSING_CANOPI_FILE_VERSION,
      minimum_supported_version: MIN_SUPPORTED_CANOPI_FILE_VERSION,
      future_version_policy: FUTURE_CANOPI_FILE_VERSION_POLICY,
      error_kinds: CANOPI_DESIGN_INGESTION_ERROR_KINDS,
    })
  })

  it.each(corpus.cases)('$id', ({ accepted, error_kind: errorKind, input }) => {
    if (accepted) {
      const expected = corpus.accepted_documents[accepted]
      const decoded = decodeCanopiDesign(input)
      expect(decoded).toEqual(expected)
      expect(decodeCanopiDesign(decoded)).toEqual(expected)
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
