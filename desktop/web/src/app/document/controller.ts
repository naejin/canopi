import { batch } from '@preact/signals'
import type { CanopiFile } from '../../types/design'
import { currentDesign, designName, nonCanvasRevision } from '../../state/design'

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

export function updateCurrentDesignMetadata(
  metadata: { name: string; description: string | null },
  options: DocumentMutationOptions = {},
): CanopiFile | null {
  const design = currentDesign.value
  if (!design) return null

  const nextName = metadata.name
  const nextDescription = metadata.description
  const nextDesign =
    design.name === nextName && design.description === nextDescription
      ? design
      : { ...design, name: nextName, description: nextDescription }

  if (nextDesign === design && designName.value === nextName) {
    return design
  }

  batch(() => {
    currentDesign.value = nextDesign
    designName.value = nextName
    if (options.markDirty !== false) {
      nonCanvasRevision.value += 1
    }
  })

  return nextDesign
}

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
