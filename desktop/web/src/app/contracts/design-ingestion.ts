import {
  CANOPI_FILE_SCHEMA,
  CURRENT_CANOPI_FILE_VERSION,
  MISSING_CANOPI_FILE_VERSION,
  OBSOLETE_CANOPI_ROOT_KEYS,
} from '../../generated/canopi-design-format'
import type { CanopiFile } from '../../types/design'
import { normalizeLoadedDocument } from './document'
import { decodeCanopiFileSchema } from './canopi-design-schema-decoder'
import {
  asCanopiDesignIngestionError,
  CanopiDesignIngestionError,
} from './canopi-design-errors'

export { CanopiDesignIngestionError }

export function decodeCanopiDesign(value: unknown): CanopiFile {
  try {
    admitCurrentDesignValue(value)
    const decoded = decodeCanopiFileSchema(value, CANOPI_FILE_SCHEMA) as CanopiFile
    return normalizeLoadedDocument(decoded)
  } catch (error) {
    throw asCanopiDesignIngestionError(error)
  }
}

function admitCurrentDesignValue(value: unknown): asserts value is Record<string, unknown> {
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
  if (version !== CURRENT_CANOPI_FILE_VERSION) {
    throw new CanopiDesignIngestionError(
      'unsupported_version',
      `$.version: unsupported Canopi Design version ${version}; current version is ${CURRENT_CANOPI_FILE_VERSION}`,
    )
  }
  const obsolete = OBSOLETE_CANOPI_ROOT_KEYS.find((key) => Object.prototype.hasOwnProperty.call(value, key))
  if (obsolete) {
    throw new CanopiDesignIngestionError(
      'invalid_document',
      `$.${obsolete}: obsolete root field; v7 stores lon/lat on each design object`,
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
