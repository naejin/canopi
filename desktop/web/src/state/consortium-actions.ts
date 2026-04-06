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
