import type { CanopiFile } from '../../types/design'
import type {
  LidarPresentationEntry,
  LidarPresentationEntryKind,
  LidarPresentationSection,
} from '../../generated/contracts'

// Mirrors common_types::lidar::LIDAR_PRESENTATION_SCHEMA_VERSION (not part of
// the generated type surface).
const LIDAR_PRESENTATION_SCHEMA_VERSION = 1

import { editCurrentDesign } from './core'

export type { LidarPresentationEntry, LidarPresentationSection, LidarPresentationEntryKind }

function emptySection(): LidarPresentationSection {
  return { schema_version: LIDAR_PRESENTATION_SCHEMA_VERSION, entries: [] }
}

export function readLidarSection(design: CanopiFile): LidarPresentationSection | null {
  return design.lidar ?? null
}

export function readLidarEntries(design: CanopiFile): LidarPresentationEntry[] {
  return design.lidar?.entries ?? []
}

/** Immutable patch of one entry; entries are matched by stable library id. */
export interface LidarEntryPatch {
  visible?: boolean
  opacity?: number
  order?: number
  style?: string | null
}

/**
 * Insert or update one presentation entry. Shared library mutations never
 * dirty a Design on their own — this seam is called from explicit user
 * actions (creating a layer or analysis, toggling visibility, restyling).
 */
export function upsertLidarEntry(
  kind: LidarPresentationEntryKind,
  id: string,
  patch: LidarEntryPatch = {},
): void {
  editCurrentDesign((design) => {
    const section = design.lidar ?? emptySection()
    const existing = section.entries.find(
      (entry) => entry.id === id && entry.kind === kind,
    )
    if (existing) {
      const next = mergeEntry(existing, patch)
      if (next === existing) {
        return design
      }
      return {
        ...design,
        lidar: {
          ...section,
          entries: section.entries.map((entry) =>
            entry === existing ? next : entry,
          ),
        },
      }
    }
    const entry: LidarPresentationEntry = {
      kind,
      id,
      visible: patch.visible ?? true,
      opacity: patch.opacity ?? 1,
      order: patch.order ?? nextOrder(section.entries),
      style: patch.style ?? null,
    }
    return {
      ...design,
      lidar: { ...section, entries: [...section.entries, entry] },
    }
  })
}

/**
 * Update an entry regardless of kind: visibility and opacity toggles address
 * one stable library identity, which is unique across kinds in practice.
 */
export function patchLidarEntryById(id: string, patch: LidarEntryPatch): void {
  editCurrentDesign((design) => {
    const section = design.lidar ?? emptySection()
    const existing = section.entries.find((entry) => entry.id === id)
    if (!existing) {
      return design
    }
    const next = mergeEntry(existing, patch)
    if (next === existing) {
      return design
    }
    return {
      ...design,
      lidar: {
        ...section,
        entries: section.entries.map((entry) => (entry === existing ? next : entry)),
      },
    }
  })
}

export function removeLidarEntries(ids: string[]): void {
  editCurrentDesign((design) => {
    const section = design.lidar
    if (!section) {
      return design
    }
    const idsSet = new Set(ids)
    const nextEntries = section.entries.filter((entry) => !idsSet.has(entry.id))
    if (nextEntries.length === section.entries.length) {
      return design
    }
    if (nextEntries.length === 0) {
      return { ...design, lidar: null }
    }
    return { ...design, lidar: { ...section, entries: nextEntries } }
  })
}

function mergeEntry(
  existing: LidarPresentationEntry,
  patch: LidarEntryPatch,
): LidarPresentationEntry {
  const next: LidarPresentationEntry = {
    ...existing,
    visible: patch.visible ?? existing.visible,
    opacity: patch.opacity ?? existing.opacity,
    order: patch.order ?? existing.order,
    style: patch.style === undefined ? existing.style : patch.style,
  }
  if (
    next.visible === existing.visible &&
    next.opacity === existing.opacity &&
    next.order === existing.order &&
    next.style === existing.style
  ) {
    return existing
  }
  return next
}

function nextOrder(entries: LidarPresentationEntry[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.order), -1) + 1
}

/**
 * Move one presentation entry one position earlier or later in saved order.
 *
 * Order is the document's own presentation order, so this is a Design Edit: it
 * dirties the current Design and travels through document history, which is
 * what makes the move undoable. Reordering presentation changes no numeric data
 * and starts no computation — it is display order only.
 *
 * A move that would leave the order unchanged returns the Design untouched, so
 * nudging the first entry up does not create a history entry for nothing.
 */
export function moveLidarEntry(id: string, direction: 'up' | 'down'): void {
  editCurrentDesign((design) => {
    const section = design.lidar
    if (!section) {
      return design
    }
    const ordered = [...section.entries].sort((left, right) => left.order - right.order)
    const index = ordered.findIndex((entry) => entry.id === id)
    if (index < 0) {
      return design
    }
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= ordered.length) {
      return design
    }
    const moved = ordered[index]!
    const displaced = ordered[target]!
    ordered[index] = displaced
    ordered[target] = moved
    // Renumber densely from zero so saved order stays stable and comparable
    // rather than accumulating gaps across repeated moves.
    const positions = new Map(ordered.map((entry, position) => [entry.id, position]))
    const nextEntries = section.entries.map((entry) => {
      const order = positions.get(entry.id)
      return order === undefined || order === entry.order ? entry : { ...entry, order }
    })
    if (nextEntries.every((entry, position) => entry === section.entries[position])) {
      return design
    }
    return { ...design, lidar: { ...section, entries: nextEntries } }
  })
}
