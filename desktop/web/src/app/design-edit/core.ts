import type { CanopiFile } from '../../types/design'
import { designSessionStore } from '../document-session/store'
import {
  designEditAuthorityCapability,
  disposeDesignEditAuthority,
  type DesignPreviewTransaction,
} from './authority-capability'

export type DesignArrayEditKey = 'timeline' | 'consortiums'

export interface DesignArrayEditTransaction<K extends DesignArrayEditKey> {
  preview(updater: (items: CanopiFile[K]) => CanopiFile[K]): void
  commit(): void
  abort(): void
  readonly hasMutated: boolean
}

export function editCurrentDesign(
  updater: (design: CanopiFile) => CanopiFile,
): CanopiFile | null {
  return designEditAuthorityCapability(designSessionStore).editCommitted(updater)
}

export function reconcileCurrentDesign(
  updater: (design: CanopiFile) => CanopiFile,
): CanopiFile | null {
  return designEditAuthorityCapability(designSessionStore).reconcileCommitted(updater)
}

export function setDesignName(name: string): void {
  const nextName = name.trim()
  if (nextName.length === 0) return
  if (nextName === designSessionStore.readDesignName()) return

  designSessionStore.renameCurrentDesign(nextName)
}

export function editDesignArray<K extends keyof CanopiFile>(
  key: K,
  updater: (arr: CanopiFile[K]) => CanopiFile[K],
): void {
  editCurrentDesign((design) => {
    const next = updater(design[key])
    return next === design[key] ? design : { ...design, [key]: next }
  })
}

class StoreDesignArrayEditTransaction<K extends DesignArrayEditKey>
  implements DesignArrayEditTransaction<K> {
  private readonly transaction: DesignPreviewTransaction

  constructor(private readonly key: K) {
    this.transaction = designEditAuthorityCapability(designSessionStore)
      .beginPreview(`Design ${key} preview`)
  }

  get hasMutated(): boolean {
    return this.transaction.hasMutated
  }

  preview(updater: (items: CanopiFile[K]) => CanopiFile[K]): void {
    this.transaction.preview((design) => {
      const items = design[this.key]
      const next = updater(items)
      return next === items ? design : { ...design, [this.key]: next }
    })
  }

  commit(): void {
    this.transaction.commit()
  }

  abort(): void {
    this.transaction.abort()
  }
}

export function beginDesignArrayEdit<K extends DesignArrayEditKey>(
  key: K,
): DesignArrayEditTransaction<K> {
  return new StoreDesignArrayEditTransaction(key)
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeDesignEditAuthority(designSessionStore)
  })
}
