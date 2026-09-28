import {
  CANOPI_FILE_SCHEMA,
  MISSING_CANOPI_FILE_VERSION,
  OBSOLETE_CANOPI_ROOT_KEYS,
} from '../../generated/canopi-design-format'
import type { CanopiFile, PendingDesignSite } from '../../types/design'
import { viewsAndStoriesProblem } from './views-admission'
import { normalizeLoadedDocument } from './document'
import { decodeCanopiFileSchema } from './canopi-design-schema-decoder'
import {
  asCanopiDesignIngestionError,
  CanopiDesignIngestionError,
  CanopiDesignNeedsSiteError,
} from './canopi-design-errors'
import { migrateToCurrent, placeAtSite, type JsonObject } from './design-migrations'
import { designIdentitiesAndRangesProblem } from './design-admission'

export { CanopiDesignIngestionError, CanopiDesignNeedsSiteError }

/** What admitting a Design's JSON produced (the Web mirror of `DesignLoadOutcome`). */
export type CanopiDesignDecodeOutcome =
  | {
    readonly kind: 'design'
    readonly file: CanopiFile
    /** The file's format version when it was older and upgraded in memory. */
    readonly migratedFrom: number | null
  }
  | { readonly kind: 'needs_site'; readonly pending: PendingDesignSite }

/**
 * Admit a Design that must open now: an older format is upgraded in memory;
 * a pre-geolocation Design without a site throws `CanopiDesignNeedsSiteError`
 * (callers that can ask use `decodeCanopiDesignOutcome`).
 */
export function decodeCanopiDesign(value: unknown): CanopiFile {
  const outcome = decodeCanopiDesignOutcome(value)
  if (outcome.kind === 'needs_site') throw new CanopiDesignNeedsSiteError(outcome.pending)
  return outcome.file
}

export function decodeCanopiDesignOutcome(value: unknown): CanopiDesignDecodeOutcome {
  try {
    const version = admitDesignVersion(value)
    const migrated = migrateToCurrent(value, version)
    if (migrated.kind === 'needs_site') return migrated
    return {
      kind: 'design',
      file: admitCurrentDesignValue(migrated.value),
      migratedFrom: migrated.migratedFrom,
    }
  } catch (error) {
    throw asCanopiDesignIngestionError(error)
  }
}

/** Finish opening a pending Design at the site the user chose. */
export function placeCanopiDesignAtSite(
  pending: PendingDesignSite,
  site: { readonly lon: number; readonly lat: number },
): CanopiFile {
  try {
    const placed = placeAtSite(pending, site)
    if (placed.kind !== 'current') throw new CanopiDesignNeedsSiteError(placed.pending)
    return admitCurrentDesignValue(placed.value)
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
