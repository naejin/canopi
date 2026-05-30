import type { CanopiFile } from '../../types/design'
import { designSessionStore, type DocumentMutationOptions } from '../document-session/store'

export function mutateCurrentDesign(
  updater: (design: CanopiFile) => CanopiFile,
  options: DocumentMutationOptions = {},
): CanopiFile | null {
  return designSessionStore.mutateCurrentDesign(updater, options)
}

export function markDocumentDirty(): void {
  designSessionStore.markDocumentDirty()
}

export function updateDesignArray<K extends keyof CanopiFile>(
  key: K,
  updater: (arr: CanopiFile[K]) => CanopiFile[K],
  options: DocumentMutationOptions = {},
): void {
  designSessionStore.updateDesignArray(key, updater, options)
}
