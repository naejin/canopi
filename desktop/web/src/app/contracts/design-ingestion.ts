import {
  CANOPI_FILE_SCHEMA,
  CURRENT_CANOPI_FILE_VERSION,
  MISSING_CANOPI_FILE_VERSION,
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
    admitV6DesignValue(value)
    const decoded = decodeCanopiFileSchema(value, CANOPI_FILE_SCHEMA) as CanopiFile
    normalizeSpatialFrame(decoded)
    return normalizeLoadedDocument(decoded)
  } catch (error) {
    throw asCanopiDesignIngestionError(error)
  }
}

function admitV6DesignValue(value: unknown): asserts value is Record<string, unknown> {
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
  if (
    Object.prototype.hasOwnProperty.call(value, 'location')
    || Object.prototype.hasOwnProperty.call(value, 'north_bearing_deg')
  ) {
    throw new CanopiDesignIngestionError(
      'invalid_document',
      '$: v6 replaces root location and north_bearing_deg with spatial_frame',
    )
  }
}

function normalizeSpatialFrame(file: CanopiFile): void {
  const bearing = file.spatial_frame.north_bearing_deg
  const normalized = ((bearing % 360) + 360) % 360
  file.spatial_frame.north_bearing_deg = Object.is(normalized, -0) ? 0 : normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
