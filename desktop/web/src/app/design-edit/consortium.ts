import type { Consortium } from '../../types/design'
import { getConsortiumCanonicalName, targets } from '../../target'
import { beginDesignArrayEdit, editDesignArray, type DesignArrayEditTransaction } from './core'

export type ConsortiumDocumentEditTransaction = DesignArrayEditTransaction<'consortiums'>

export function beginConsortiumDocumentEdit(): ConsortiumDocumentEditTransaction {
  return beginDesignArrayEdit('consortiums')
}

export function upsertConsortiumEntry(entry: Consortium): void {
  editDesignArray('consortiums', (consortiums) => upsertConsortiumEntryInArray(consortiums, entry))
}

export function upsertConsortiumEntryInArray(consortiums: Consortium[], entry: Consortium): Consortium[] {
  const index = consortiums.findIndex((consortium) => targets.equals(consortium.target, entry.target))
  if (index >= 0) {
    const existing = consortiums[index]!
    if (
      existing.stratum === entry.stratum &&
      existing.start_phase === entry.start_phase &&
      existing.end_phase === entry.end_phase &&
      targets.equals(existing.target, entry.target)
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
  editDesignArray('consortiums', (consortiums) => {
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
  editDesignArray('consortiums', (consortiums) => reorderConsortiumEntryInArray(consortiums, canonicalName, targetIndex))
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
  editDesignArray('consortiums', (consortiums) => moveConsortiumEntryInArray(consortiums, canonicalName, updates))
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
