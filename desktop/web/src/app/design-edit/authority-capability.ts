import type { CanopiFile } from '../../types/design'

export type DesignProjector = (design: CanopiFile) => CanopiFile

export interface DesignEditAuthorityCapability {
  editCommitted(projector: DesignProjector): CanopiFile | null
  reconcileCommitted(projector: DesignProjector): CanopiFile | null
  markCommittedDirty(): void
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
