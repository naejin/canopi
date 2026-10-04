import {
  CANOPI_FILE_SCHEMA,
  CURRENT_CANOPI_FILE_VERSION,
  MISSING_CANOPI_FILE_VERSION,
  OBSOLETE_CANOPI_ROOT_KEYS,
} from '../../generated/canopi-design-format'
import type { CanopiFile } from '../../types/design'
import { mapViewProblem, viewsAndStoriesProblem } from './views-admission'
import { normalizeLoadedDocument } from './document'
import { decodeCanopiFileSchema } from './canopi-design-schema-decoder'
import { asCanopiDesignIngestionError, CanopiDesignIngestionError } from './canopi-design-errors'
import { designIdentitiesAndRangesProblem } from './design-admission'

export { CanopiDesignIngestionError }

/**
 * Admit a Design: the Web mirror of `decode_design_value`. Canopi 2.0 breaks
 * stored data (ADR 0021): there is no migration ladder, and any version other
 * than the current one is refused as `unsupported_version`.
 */
export function decodeCanopiDesign(value: unknown): CanopiFile {
  try {
    const version = admitDesignVersion(value)
    if (version !== CURRENT_CANOPI_FILE_VERSION) {
      throw new CanopiDesignIngestionError(
        'unsupported_version',
        `$.version: unsupported Canopi Design version ${version}; Canopi 2.0 and later open only version ${CURRENT_CANOPI_FILE_VERSION}`,
        version,
      )
    }
    return admitCurrentDesignValue(value as Record<string, unknown>)
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

/** Current-format admission. */
function admitCurrentDesignValue(value: Record<string, unknown>): CanopiFile {
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
    ?? mapViewProblem(decoded.map_view)
  if (problem) throw new CanopiDesignIngestionError('invalid_document', problem)
  return decoded
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
