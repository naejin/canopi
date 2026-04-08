import type { Consortium } from '../types/design'
import { updateDesignArray } from './document-mutations'

interface ConsortiumUpdateOptions {
  markDirty?: boolean
}

function updateConsortiums(
  updater: (consortiums: Consortium[]) => Consortium[],
  options: ConsortiumUpdateOptions = {},
): void {
  updateDesignArray('consortiums', updater, options)
}

export function upsertConsortiumEntry(entry: Consortium, options: ConsortiumUpdateOptions = {}): void {
  updateConsortiums((consortiums) => {
    const idx = consortiums.findIndex((c) => c.canonical_name === entry.canonical_name)
    if (idx >= 0) {
      const existing = consortiums[idx]!
      if (existing.stratum === entry.stratum && existing.start_phase === entry.start_phase && existing.end_phase === entry.end_phase) {
        return consortiums
      }
      const updated = [...consortiums]
      updated[idx] = entry
      return updated
    }
    return [...consortiums, entry]
  }, options)
}

export function deleteConsortiumEntry(canonicalName: string, options: ConsortiumUpdateOptions = {}): void {
  updateConsortiums((consortiums) => {
    if (!consortiums.some((c) => c.canonical_name === canonicalName)) return consortiums
    return consortiums.filter((c) => c.canonical_name !== canonicalName)
  }, options)
}

/** Move an entry to a new position in the consortiums array, shifting others. */
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
    (consortiums) => {
      const idx = consortiums.findIndex((c) => c.canonical_name === canonicalName)
      if (idx === -1) return consortiums
      const c = consortiums[idx]!
      const nextStratum = updates.stratum ?? c.stratum
      if (c.start_phase === updates.startPhase && c.end_phase === updates.endPhase && c.stratum === nextStratum) {
        return consortiums
      }
      const next = [...consortiums]
      next[idx] = { ...c, stratum: nextStratum, start_phase: updates.startPhase, end_phase: updates.endPhase }
      return next
    },
    options,
  )
}
