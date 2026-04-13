import { batch } from '@preact/signals'
import type { CanopiFile } from '../types/design'
import { currentDesign, nonCanvasRevision } from './design'
export { replaceCurrentDesignSnapshot } from '../app/document-session/snapshot'

interface DocumentMutationOptions {
  markDirty?: boolean
}

export function mutateCurrentDesign(
  updater: (design: CanopiFile) => CanopiFile,
  options: DocumentMutationOptions = {},
): CanopiFile | null {
  const design = currentDesign.value
  if (!design) return null

  const next = updater(design)
  if (next === design) return design

  batch(() => {
    currentDesign.value = next
    if (options.markDirty !== false) {
      nonCanvasRevision.value += 1
    }
  })

  return next
}

export function markDocumentDirty(): void {
  nonCanvasRevision.value += 1
}

/**
 * Generic updater for array fields on CanopiFile.
 * Identity-guards the array to prevent no-op mutations from creating new objects.
 */
export function updateDesignArray<K extends keyof CanopiFile>(
  key: K,
  updater: (arr: CanopiFile[K]) => CanopiFile[K],
  options: DocumentMutationOptions = {},
): void {
  mutateCurrentDesign((design) => {
    const next = updater(design[key])
    if (next === design[key]) return design
    return { ...design, [key]: next }
  }, options)
}
