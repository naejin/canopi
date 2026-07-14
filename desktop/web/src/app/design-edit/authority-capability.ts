import type { CanopiFile } from '../../types/design'

export type DesignProjector = (design: CanopiFile) => CanopiFile

export type DesignPreviewOutcome =
  | { readonly status: 'committed'; readonly changed: boolean }
  | { readonly status: 'aborted' }
  | { readonly status: 'superseded' }

export interface DesignPreviewTransaction {
  readonly hasMutated: boolean
  preview(projector: DesignProjector): void
  commit(): DesignPreviewOutcome
  abort(): DesignPreviewOutcome
}

export interface DesignEditAuthorityCapability {
  editCommitted(projector: DesignProjector): CanopiFile | null
  reconcileCommitted(projector: DesignProjector): CanopiFile | null
  markCommittedDirty(): void
  beginPreview(intent: string): DesignPreviewTransaction
}

export class DesignEditBusyError extends Error {
  constructor(readonly activeIntent: string) {
    super(`Design Edit '${activeIntent}' is still active`)
    this.name = 'DesignEditBusyError'
  }
}

export class DesignEditUnavailableError extends Error {
  constructor() {
    super('Cannot begin a Design Edit without an active Design')
    this.name = 'DesignEditUnavailableError'
  }
}

const authorities = new WeakMap<object, DesignEditAuthorityCapability>()
const authorityDisposers = new WeakMap<object, () => void>()

export function registerDesignEditAuthorityCapability(
  owner: object,
  authority: DesignEditAuthorityCapability,
  dispose: () => void,
): void {
  if (authorities.has(owner)) {
    throw new Error('Design Edit authority is already registered for this Design Session store')
  }
  authorities.set(owner, authority)
  authorityDisposers.set(owner, dispose)
}

export function designEditAuthorityCapability(
  owner: object,
): DesignEditAuthorityCapability {
  const authority = authorities.get(owner)
  if (!authority) {
    throw new Error('Design Session store has no Design Edit authority')
  }
  return authority
}

export function disposeDesignEditAuthority(owner: object): void {
  const dispose = authorityDisposers.get(owner)
  if (!dispose) throw new Error('Design Session store has no Design Edit authority')
  dispose()
}
