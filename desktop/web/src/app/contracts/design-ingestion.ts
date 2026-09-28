import {
  CANOPI_FILE_SCHEMA,
  MISSING_CANOPI_FILE_VERSION,
  OBSOLETE_CANOPI_ROOT_KEYS,
} from '../../generated/canopi-design-format'
import type { CanopiFile } from '../../types/design'
import { viewsAndStoriesProblem } from './views-admission'
import { normalizeLoadedDocument } from './document'
import { decodeCanopiFileSchema } from './canopi-design-schema-decoder'
import { asCanopiDesignIngestionError, CanopiDesignIngestionError } from './canopi-design-errors'
import { migrateToCurrent, type JsonObject } from './design-migrations'
import { designIdentitiesAndRangesProblem } from './design-admission'

export { CanopiDesignIngestionError }

/** What admitting a Design's JSON produced (the Web mirror of `LoadedDesign`'s payload). */
export interface CanopiDesignDecodeOutcome {
  readonly file: CanopiFile
  /** The file's format version when it was older and upgraded in memory. */
  readonly migratedFrom: number | null
}

/** Admit a Design; an older supported format is upgraded in memory. */
export function decodeCanopiDesign(value: unknown): CanopiFile {
  return decodeCanopiDesignOutcome(value).file
}

export function decodeCanopiDesignOutcome(value: unknown): CanopiDesignDecodeOutcome {
  try {
    const version = admitDesignVersion(value)
    const migrated = migrateToCurrent(value, version)
    return {
      file: admitCurrentDesignValue(migrated.value),
      migratedFrom: migrated.migratedFrom,
    }
  } catch (error) {
    throw asCanopiDesignIngestionError(error)
  }
}

function admitDesignVersion(value: unknown): number {
  if (!isRecord(value)) throw new Error('$: expected a Canopi Design object')

  const version = Object.prototype.hasOwnProperty.call(value, 'version')
    ? value.version
    : MISSING_CANOPI_FILE_VERSION
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new CanopiDesignIngestionError(
      'invalid_version',
      '$.version: expected a positive integer',
    )
  }
  return version
}

/** Current-format admission, after the migration ladder. */
function admitCurrentDesignValue(value: JsonObject): CanopiFile {
  const obsolete = OBSOLETE_CANOPI_ROOT_KEYS.find((key) => Object.prototype.hasOwnProperty.call(value, key))
  if (obsolete) {
    throw new CanopiDesignIngestionError(
      'invalid_document',
      `$.${obsolete}: obsolete root field; Designs store lon/lat on each design object`,
    )
  }
  // Unknown fields travel at the root; `extra` is only the in-memory holder
  // and the canonical encoder never writes it, so a root `extra` is refused.
  if (Object.prototype.hasOwnProperty.call(value, 'extra')) {
    throw new CanopiDesignIngestionError(
      'invalid_document',
      '$.extra: unknown fields belong at the document root',
    )
  }
  const decoded = normalizeLoadedDocument(decodeCanopiFileSchema(value, CANOPI_FILE_SCHEMA) as CanopiFile)
  const problem = designIdentitiesAndRangesProblem(decoded)
    ?? viewsAndStoriesProblem(decoded.views ?? [], decoded.stories ?? [])
  if (problem) throw new CanopiDesignIngestionError('invalid_document', problem)
  return decoded
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
