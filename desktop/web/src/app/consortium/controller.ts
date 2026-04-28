import type { Consortium } from '../../types/design'
import { getConsortiumCanonicalName, panelTargetEqual } from '../../panel-targets'
import { updateDesignArray } from '../document/controller'

function updateConsortiums(
  updater: (consortiums: Consortium[]) => Consortium[],
): void {
  updateDesignArray('consortiums', updater)
}

export function upsertConsortiumEntry(entry: Consortium): void {
  updateConsortiums((consortiums) => upsertConsortiumEntryInArray(consortiums, entry))
}

export function upsertConsortiumEntryInArray(consortiums: Consortium[], entry: Consortium): Consortium[] {
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
}

export function deleteConsortiumEntry(canonicalName: string): void {
  updateConsortiums((consortiums) => {
    if (!consortiums.some((consortium) => getConsortiumCanonicalName(consortium) === canonicalName)) {
      return consortiums
    }
    return consortiums.filter((consortium) => getConsortiumCanonicalName(consortium) !== canonicalName)
  })
}

export function reorderConsortiumEntry(
  canonicalName: string,
  targetIndex: number,
): void {
  updateConsortiums((consortiums) => reorderConsortiumEntryInArray(consortiums, canonicalName, targetIndex))
}

export function reorderConsortiumEntryInArray(
  consortiums: Consortium[],
  canonicalName: string,
  targetIndex: number,
): Consortium[] {
  const currentIndex = consortiums.findIndex((consortium) => getConsortiumCanonicalName(consortium) === canonicalName)
  if (currentIndex === -1 || currentIndex === targetIndex) return consortiums

  const next = [...consortiums]
  const [entry] = next.splice(currentIndex, 1)
  next.splice(targetIndex, 0, entry!)
  return next
}

export function moveConsortiumEntry(
  canonicalName: string,
  updates: { stratum?: string; startPhase: number; endPhase: number },
): void {
  updateConsortiums((consortiums) => moveConsortiumEntryInArray(consortiums, canonicalName, updates))
}

export function moveConsortiumEntryInArray(
  consortiums: Consortium[],
  canonicalName: string,
  updates: { stratum?: string; startPhase: number; endPhase: number },
): Consortium[] {
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
}
