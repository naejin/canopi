import type { Consortium } from '../../types/design'
import { getConsortiumCanonicalName, panelTargetEqual } from '../../panel-targets'
import { updateDesignArray } from '../document/controller'

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
    const index = consortiums.findIndex((consortium) => panelTargetEqual(consortium.target, entry.target))
    if (index >= 0) {
      const existing = consortiums[index]!
      if (
        existing.stratum === entry.stratum &&
        existing.start_phase === entry.start_phase &&
        existing.end_phase === entry.end_phase &&
        panelTargetEqual(existing.target, entry.target)
      ) {
        return consortiums
      }

      const updated = [...consortiums]
      updated[index] = entry
      return updated
    }

    return [...consortiums, entry]
  }, options)
}

export function deleteConsortiumEntry(canonicalName: string, options: ConsortiumUpdateOptions = {}): void {
  updateConsortiums((consortiums) => {
    if (!consortiums.some((consortium) => getConsortiumCanonicalName(consortium) === canonicalName)) {
      return consortiums
    }
    return consortiums.filter((consortium) => getConsortiumCanonicalName(consortium) !== canonicalName)
  }, options)
}

export function reorderConsortiumEntry(
  canonicalName: string,
  targetIndex: number,
  options: ConsortiumUpdateOptions = {},
): void {
  updateConsortiums((consortiums) => {
    const currentIndex = consortiums.findIndex((consortium) => getConsortiumCanonicalName(consortium) === canonicalName)
    if (currentIndex === -1 || currentIndex === targetIndex) return consortiums

    const next = [...consortiums]
    const [entry] = next.splice(currentIndex, 1)
    next.splice(targetIndex, 0, entry!)
    return next
  }, options)
}

export function moveConsortiumEntry(
  canonicalName: string,
  updates: { stratum?: string; startPhase: number; endPhase: number },
  options: ConsortiumUpdateOptions = {},
): void {
  updateConsortiums((consortiums) => {
    const index = consortiums.findIndex((consortium) => getConsortiumCanonicalName(consortium) === canonicalName)
    if (index === -1) return consortiums

    const existing = consortiums[index]!
    const nextStratum = updates.stratum ?? existing.stratum
    if (
      existing.start_phase === updates.startPhase &&
      existing.end_phase === updates.endPhase &&
      existing.stratum === nextStratum
    ) {
      return consortiums
    }

    const next = [...consortiums]
    next[index] = {
      ...existing,
      stratum: nextStratum,
      start_phase: updates.startPhase,
      end_phase: updates.endPhase,
    }
    return next
  }, options)
}
