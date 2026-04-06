import type { Consortium } from '../types/design'
import { mutateCurrentDesign } from './document-mutations'

interface ConsortiumUpdateOptions {
  markDirty?: boolean
}

function updateConsortiums(
  updater: (consortiums: Consortium[]) => Consortium[],
  options: ConsortiumUpdateOptions = {},
): void {
  mutateCurrentDesign((design) => ({
    ...design,
    consortiums: updater(design.consortiums ?? []),
  }), { markDirty: options.markDirty !== false })
}

export function upsertConsortiumEntry(entry: Consortium, options: ConsortiumUpdateOptions = {}): void {
  updateConsortiums((consortiums) => {
    const idx = consortiums.findIndex((c) => c.canonical_name === entry.canonical_name)
    if (idx >= 0) {
      const updated = [...consortiums]
      updated[idx] = entry
      return updated
    }
    return [...consortiums, entry]
  }, options)
}

export function deleteConsortiumEntry(canonicalName: string, options: ConsortiumUpdateOptions = {}): void {
  updateConsortiums((consortiums) => consortiums.filter((c) => c.canonical_name !== canonicalName), options)
}

/** Swap two entries' positions within the consortiums array to change sub-lane order. */
export function reorderConsortiumEntry(
  canonicalName: string,
  targetIndex: number,
  options: ConsortiumUpdateOptions = {},
): void {
  updateConsortiums((consortiums) => {
    const currentIdx = consortiums.findIndex((c) => c.canonical_name === canonicalName)
    if (currentIdx === -1 || currentIdx === targetIndex) return consortiums
    const next = [...consortiums]
    const [entry] = next.splice(currentIdx, 1)
    next.splice(targetIndex, 0, entry!)
    return next
  }, options)
}

export function moveConsortiumEntry(
  canonicalName: string,
  updates: { stratum?: string; startPhase: number; endPhase: number },
  options: ConsortiumUpdateOptions = {},
): void {
  updateConsortiums(
    (consortiums) => consortiums.map((c) =>
      c.canonical_name === canonicalName
        ? { ...c, stratum: updates.stratum ?? c.stratum, start_phase: updates.startPhase, end_phase: updates.endPhase }
        : c,
    ),
    options,
  )
}
