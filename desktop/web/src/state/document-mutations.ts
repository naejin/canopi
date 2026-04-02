import { batch } from '@preact/signals'
import type { CanopiFile } from '../types/design'
import { currentConsortiums, designLocation } from './canvas'
import { currentDesign, nonCanvasRevision } from './design'

interface DocumentMutationOptions {
  markDirty?: boolean
}

export function syncDocumentMirrors(file: CanopiFile | null): void {
  currentConsortiums.value = file?.consortiums ?? []
  designLocation.value = file?.location
    ? { lat: file.location.lat, lon: file.location.lon }
    : null
}

export function replaceCurrentDesignSnapshot(file: CanopiFile): void {
  batch(() => {
    currentDesign.value = file
    syncDocumentMirrors(file)
  })
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
    syncDocumentMirrors(next)
    if (options.markDirty !== false) {
      nonCanvasRevision.value += 1
    }
  })

  return next
}

export function markDocumentDirty(): void {
  nonCanvasRevision.value += 1
}
