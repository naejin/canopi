import { t } from '../../i18n'
import { textGraphemes } from '../../utils/text-graphemes'
import type { MapSelectionSummary } from './summary'
import { formatArea, formatLength, zoneTypeLabel } from './zone-label'

// The words that name a map selection: the selection chip's head and parts
// ("12 plants · Apricot · 0.52 m apart"), and the same line as the right-click
// menu's heading.

/** One part after the head; a measure never breaks inside ("0.52 m apart"). */
export interface ChipDetail {
  readonly text: string
  readonly measure?: boolean
}

const NOTE_PREVIEW_GRAPHEMES = 40

export function describeMapSelection(summary: MapSelectionSummary, activeLocale: string): { head: string; details: ChipDetail[] } {
  const { plantCount, species, zones, noteCount, measurementCount } = summary
  const zoneCount = zones.length
  const kinds = [plantCount, zoneCount, noteCount, measurementCount].filter((count) => count > 0).length
  const plain = (text: string): ChipDetail => ({ text })
  const measure = (text: string): ChipDetail => ({ text, measure: true })
  if (kinds > 1) {
    return {
      head: t('canvas.selectionChip.selected', { count: plantCount + zoneCount + noteCount + measurementCount }),
      details: [
        plantCount > 0 ? t('canvas.selectionChip.plants', { count: plantCount }) : '',
        zoneCount > 0 ? t('canvas.selectionChip.zones', { count: zoneCount }) : '',
        noteCount > 0 ? t('canvas.selectionChip.notes', { count: noteCount }) : '',
        measurementCount > 0 ? t('canvas.selectionChip.measurements', { count: measurementCount }) : '',
      ].filter(Boolean).map(plain),
    }
  }
  if (plantCount > 0) {
    if (plantCount === 1) return { head: species[0]!.name, details: [] }
    const spacing = summary.plantSpacingM
    return {
      head: t('canvas.selectionChip.plants', { count: plantCount }),
      details: [
        plain(species.length === 1 ? species[0]!.name : t('canvas.selectionChip.species', { count: species.length })),
        ...(spacing === null ? [] : [measure(t('canvas.selectionChip.apart', { distance: formatLength(spacing, activeLocale) }))]),
      ],
    }
  }
  if (zoneCount === 1) {
    const zone = zones[0]!
    // A zone the user has not named is named by its type, never by its id.
    const head = zone.name === null ? zoneTypeLabel(zone.zoneType) : t('canvas.selectionChip.zone')
    return {
      head,
      details: [
        ...(zone.name === null ? [] : [plain(zone.name)]),
        ...(zone.areaM2 === null ? [] : [measure(formatArea(zone.areaM2, activeLocale))]),
        ...(zone.perimeterM === null ? [] : [measure(formatLength(zone.perimeterM, activeLocale))]),
      ],
    }
  }
  if (zoneCount > 1) return { head: t('canvas.selectionChip.zones', { count: zoneCount }), details: [] }
  if (noteCount === 1 && summary.noteText !== null) {
    const preview = notePreview(summary.noteText)
    return { head: t('canvas.selectionChip.note'), details: preview ? [plain(preview)] : [] }
  }
  if (noteCount > 0) return { head: t('canvas.selectionChip.notes', { count: noteCount }), details: [] }
  if (measurementCount === 1 && summary.measurementLengthM !== null) {
    return { head: t('canvas.selectionChip.measurement'), details: [measure(formatLength(summary.measurementLengthM, activeLocale))] }
  }
  return { head: t('canvas.selectionChip.measurements', { count: measurementCount }), details: [] }
}

/** The note's first line, cut at a readable length. */
function notePreview(text: string): string {
  const line = text.split('\n').map((part) => part.trim()).find(Boolean) ?? ''
  const graphemes = textGraphemes(line)
  return graphemes.length > NOTE_PREVIEW_GRAPHEMES ? `${graphemes.slice(0, NOTE_PREVIEW_GRAPHEMES - 1).join('').trimEnd()}…` : line
}

/** One line naming the selection, as the chip reads it. */
export function mapSelectionHeading(summary: MapSelectionSummary, activeLocale: string): string {
  const { head, details } = describeMapSelection(summary, activeLocale)
  return [head, ...details.map((detail) => detail.text)].join(' · ')
}
