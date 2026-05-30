import type { CanopiFile } from '../../types/design'
import { currentDesign } from '../document-session/store'
import { markDocumentDirty, updateDesignArray } from './controller'

export type DocumentArrayEditKey = 'timeline' | 'consortiums'

export interface DocumentArrayEditTransaction<K extends DocumentArrayEditKey> {
  preview(updater: (items: CanopiFile[K]) => CanopiFile[K]): void
  commit(): void
  abort(): void
  readonly hasMutated: boolean
}

class SignalDocumentArrayEditTransaction<K extends DocumentArrayEditKey>
  implements DocumentArrayEditTransaction<K> {
  private original: CanopiFile[K] | null
  private mutated = false
  private closed = false

  constructor(private readonly key: K) {
    this.original = currentDesign.peek()?.[key] ?? null
  }

  get hasMutated(): boolean {
    return this.mutated
  }

  preview(updater: (items: CanopiFile[K]) => CanopiFile[K]): void {
    if (this.closed) return

    const design = currentDesign.peek()
    if (!design) return
    this.original ??= design[this.key]

    let changed = false
    updateDesignArray(this.key, (items) => {
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
    if (this.mutated) markDocumentDirty()
  }

  abort(): void {
    if (this.closed) return
    this.closed = true
    if (!this.mutated || this.original == null) return
    updateDesignArray(this.key, () => this.original!, { markDirty: false })
  }
}

export function beginDocumentArrayEdit<K extends DocumentArrayEditKey>(
  key: K,
): DocumentArrayEditTransaction<K> {
  return new SignalDocumentArrayEditTransaction(key)
}
