import type {
  LidarColourRange,
  LidarPresentationEntry,
  LidarPresentationEntryKind,
  LidarPresentationSection,
  LidarRamp,
} from '../../generated/contracts'

// Mirrors common_types::lidar::LIDAR_PRESENTATION_SCHEMA_VERSION (not part of
// the generated type surface).
const LIDAR_PRESENTATION_SCHEMA_VERSION = 1

import { editCurrentDesign } from './core'

function emptySection(): LidarPresentationSection {
  return { schema_version: LIDAR_PRESENTATION_SCHEMA_VERSION, visible: true, entries: [] }
}

/**
 * Immutable patch of one entry; entries are matched by stable library id.
 * A null `ramp` or `range` is the item kind's default.
 */
export interface LidarEntryPatch {
  visible?: boolean
  opacity?: number
  order?: number
  ramp?: LidarRamp | null
  reversed?: boolean
  range?: LidarColourRange | null
}

/**
 * Insert or update one presentation entry. Shared library mutations never
 * dirty a Design on their own — this seam is called from explicit user
 * actions (creating a layer or analysis, toggling visibility, restyling).
 * A new entry stores the library item's `name` so a missing item still reads
 * by name; an existing entry keeps its own (the name reconcile refreshes it).
 */
export function upsertLidarEntry(
  kind: LidarPresentationEntryKind,
  id: string,
  name: string,
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
      name,
      visible: patch.visible ?? true,
      opacity: patch.opacity ?? 1,
      order: patch.order ?? nextOrder(section.entries),
      ramp: null,
      reversed: false,
      range: null,
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
    ramp: patch.ramp === undefined ? existing.ramp : patch.ramp,
    reversed: patch.reversed ?? existing.reversed,
    range: patch.range === undefined || sameRange(patch.range, existing.range) ? existing.range : patch.range,
  }
  if (
    next.visible === existing.visible &&
    next.opacity === existing.opacity &&
    next.order === existing.order &&
    next.ramp === existing.ramp &&
    next.reversed === existing.reversed &&
    next.range === existing.range
  ) {
    return existing
  }
  return next
}

function sameRange(left: LidarColourRange | null, right: LidarColourRange | null): boolean {
  if (left === null || right === null) return left === right
  if (left.mode === 'Custom' && right.mode === 'Custom') {
    return left.min === right.min && left.max === right.max
  }
  return left.mode === right.mode
}

/**
 * The Site data eye in Layers: one flag folded with each entry's own eye, so
 * hiding all site data keeps every row's own choice. A Design Edit with no
 * undo, like every site-data Design Edit; nothing happens without a section.
 */
export function setSiteDataVisible(visible: boolean): void {
  editCurrentDesign((design) => {
    const section = design.lidar
    if (!section || section.visible === visible) {
      return design
    }
    return { ...design, lidar: { ...section, visible } }
  })
}

function nextOrder(entries: LidarPresentationEntry[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.order), -1) + 1
}

/**
 * Set the saved order of several entries at once.
 *
 * Order is the document's own presentation order, so this is a Design Edit: it
 * dirties the current Design for continuous save and, like every Design Edit,
 * has no undo. Reordering presentation changes no numeric data
 * and starts no computation; it is display order only. Orders that are already
 * saved leave the Design untouched.
 */
export function setLidarEntryOrders(orders: ReadonlyMap<string, number>): void {
  editCurrentDesign((design) => {
    const section = design.lidar
    if (!section) {
      return design
    }
    const nextEntries = section.entries.map((entry) => {
      const order = orders.get(entry.id)
      return order === undefined || order === entry.order ? entry : { ...entry, order }
    })
    if (nextEntries.every((entry, position) => entry === section.entries[position])) {
      return design
    }
    return { ...design, lidar: { ...section, entries: nextEntries } }
  })
}
