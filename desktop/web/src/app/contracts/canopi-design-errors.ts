import {
  CURRENT_CANOPI_FILE_VERSION,
  type CanopiDesignIngestionErrorKind,
} from '../../generated/canopi-design-format'
import type { DesignLoadFailure, DesignLoadFailureKind, PendingDesignSite } from '../../types/design'
import { DesignMigrationError } from './design-migrations'

export class CanopiDesignIngestionError extends Error {
  constructor(
    readonly kind: CanopiDesignIngestionErrorKind,
    message: string,
    /** The file's version when `kind` is `unsupported_version`. */
    readonly unsupportedVersion: number | null = null,
  ) {
    super(message)
    this.name = 'CanopiDesignIngestionError'
  }
}

/**
 * A pre-geolocation Design (format v5 or v6) without a site, met where no
 * "Where is your site?" prompt can run. Carries what the prompt would need.
 */
export class CanopiDesignNeedsSiteError extends CanopiDesignIngestionError {
  constructor(readonly pending: PendingDesignSite) {
    super(
      'unsupported_version',
      `$.version: Canopi Design version ${pending.from_version} predates geolocation and has no site; open it from Start to place it`,
    )
    this.name = 'CanopiDesignNeedsSiteError'
  }
}

export function asCanopiDesignIngestionError(error: unknown): CanopiDesignIngestionError {
  if (error instanceof CanopiDesignIngestionError) return error
  if (error instanceof DesignMigrationError) {
    return new CanopiDesignIngestionError(error.kind, error.message, error.unsupportedVersion)
  }
  return new CanopiDesignIngestionError(
    'invalid_document',
    error instanceof Error ? error.message : String(error),
  )
}

const DESIGN_LOAD_FAILURE_KINDS: readonly DesignLoadFailureKind[] = [
  'missing',
  'unreadable',
  'too_large',
  'invalid_json',
  'older_version',
  'newer_version',
  'invalid_document',
  'internal',
]

/**
 * The typed failure a native `load_design` rejection carries, or the
 * equivalent for a Web ingestion error; null for anything else (a cancelled
 * dialog, an unexpected exception).
 */
export function designLoadFailureOf(error: unknown): DesignLoadFailure | null {
  if (error instanceof CanopiDesignNeedsSiteError) {
    return { kind: 'older_version', message: error.message }
  }
  if (error instanceof CanopiDesignIngestionError) {
    const newer = error.unsupportedVersion !== null && error.unsupportedVersion > CURRENT_CANOPI_FILE_VERSION
    return {
      kind: error.kind === 'unsupported_version'
        ? (newer ? 'newer_version' : 'older_version')
        : 'invalid_document',
      message: error.message,
    }
  }
  if (
    error !== null
    && typeof error === 'object'
    && 'kind' in error
    && 'message' in error
    && typeof error.message === 'string'
    && (DESIGN_LOAD_FAILURE_KINDS as readonly unknown[]).includes(error.kind)
  ) {
    return { kind: error.kind as DesignLoadFailureKind, message: error.message }
  }
  return null
}

/** The Start-screen string that says why a Design could not be opened. */
export function designLoadFailureMessageKey(kind: DesignLoadFailureKind): string {
  switch (kind) {
    case 'missing':
      return 'start.cantReadMissing'
    case 'older_version':
      return 'start.cantReadOlderVersion'
    case 'newer_version':
      return 'start.cantReadNewerVersion'
    case 'invalid_json':
    case 'invalid_document':
      return 'start.cantReadDamaged'
    case 'unreadable':
    case 'too_large':
    case 'internal':
      return 'start.cantRead'
  }
}

/** A one-line description of a load error for logs and fallback messages; never a path. */
export function describeDesignLoadError(error: unknown): string {
  const failure = designLoadFailureOf(error)
  if (failure) return failure.message
  return error instanceof Error ? error.message : String(error)
}
