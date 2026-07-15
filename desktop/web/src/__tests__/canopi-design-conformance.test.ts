import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CanopiDesignIngestionError,
  decodeCanopiDesign,
} from '../app/contracts/design-ingestion'

interface ConformanceCase {
  readonly id: string
  readonly input: unknown
  readonly accepted?: string
  readonly error_kind?: string
}

interface ConformanceCorpus {
  readonly accepted_documents: Readonly<Record<string, unknown>>
  readonly cases: readonly ConformanceCase[]
}

const corpus = JSON.parse(readFileSync(
  '../../common-types/canopi-design-conformance.json',
  'utf8',
)) as ConformanceCorpus

describe('shared Canopi Design conformance corpus', () => {
  it.each(corpus.cases)('$id', ({ accepted, error_kind: errorKind, input }) => {
    if (accepted) {
      expect(decodeCanopiDesign(input)).toEqual(corpus.accepted_documents[accepted])
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
