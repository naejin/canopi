import type { CanopiFile } from '../../types/design'
import { designSessionStore, type DocumentMutationOptions } from '../document-session/store'

export type DesignArrayEditKey = 'timeline' | 'consortiums'

export interface DesignArrayEditTransaction<K extends DesignArrayEditKey> {
  preview(updater: (items: CanopiFile[K]) => CanopiFile[K]): void
  commit(): void
  abort(): void
  readonly hasMutated: boolean
}

export function editCurrentDesign(
  updater: (design: CanopiFile) => CanopiFile,
  options: DocumentMutationOptions = {},
): CanopiFile | null {
  return designSessionStore.mutateCurrentDesign(updater, options)
}

export function markDesignEdited(): void {
  designSessionStore.markDocumentDirty()
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
  options: DocumentMutationOptions = {},
): void {
  designSessionStore.updateDesignArray(key, updater, options)
}

class StoreDesignArrayEditTransaction<K extends DesignArrayEditKey>
  implements DesignArrayEditTransaction<K> {
  private original: CanopiFile[K] | null
  private mutated = false
  private closed = false

  constructor(private readonly key: K) {
    this.original = designSessionStore.readCurrentDesign()?.[key] ?? null
  }

  get hasMutated(): boolean {
    return this.mutated
  }

  preview(updater: (items: CanopiFile[K]) => CanopiFile[K]): void {
    if (this.closed) return

    const design = designSessionStore.readCurrentDesign()
    if (!design) return
    this.original ??= design[this.key]

    let changed = false
    editDesignArray(this.key, (items) => {
      const next = updater(items)
      if (next === items) return items
      changed = true
      return next
    }, { markDirty: false })
    if (changed) this.mutated = true
  }

  commit(): void {
    if (this.closed) return
    this.closed = true
    if (this.mutated) markDesignEdited()
  }

  abort(): void {
    if (this.closed) return
    this.closed = true
    if (!this.mutated || this.original == null) return
    editDesignArray(this.key, () => this.original!, { markDirty: false })
  }
}

export function beginDesignArrayEdit<K extends DesignArrayEditKey>(
  key: K,
): DesignArrayEditTransaction<K> {
  return new StoreDesignArrayEditTransaction(key)
}
