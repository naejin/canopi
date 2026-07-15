import type { CanopiDesignIngestionErrorKind } from '../../generated/canopi-design-format'

export class CanopiDesignIngestionError extends Error {
  constructor(
    readonly kind: CanopiDesignIngestionErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'CanopiDesignIngestionError'
  }
}

export function asCanopiDesignIngestionError(error: unknown): CanopiDesignIngestionError {
  if (error instanceof CanopiDesignIngestionError) return error
  return new CanopiDesignIngestionError(
    'invalid_document',
    error instanceof Error ? error.message : String(error),
  )
}
