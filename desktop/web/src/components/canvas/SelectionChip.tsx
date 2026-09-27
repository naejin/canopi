import { canvasCommandDefinitions } from '../../app/canvas-commands'
import { useMapSelectionSummary, type MapSelectionSummary } from '../../app/map-selection/summary'
import { ariaKeyShortcuts } from '../../app/shell-commands/shortcut-text'
import { currentCanvasQuerySurface, currentCanvasSceneEditCommandSurface } from '../../canvas/session'
import { locale } from '../../app/settings/state'
import { t } from '../../i18n'
import { textGraphemes } from '../../utils/text-graphemes'
import styles from './SelectionChip.module.css'

/**
 * The bottom status chip that names the map selection ("Apricot", "12 plants ·
 * 3 species · 0.52 m apart", "Zone · Z04 · 118 m² · 46 m", "Rectangle zone ·
 * 120 m² · 44 m") in the visible map area, above the view chip and
 * the zoom group, so it never meets the top finder chip. It reads the
 * selection through read-only runtime queries and offers Select all of this
 * species and Clear selection; the rest lives in the right-click menu.
 */
const SELECT_SAME_SPECIES = canvasCommandDefinitions.find((definition) =>
  definition.kind === 'edit' && definition.id === 'select-same-species')!

export function SelectionChip() {
  const summary = useMapSelectionSummary()
  const overview = currentCanvasQuerySurface.value?.viewport.value.mode === 'overview'
  if (!summary || overview) return null
  const { head, details } = describe(summary, locale.value)
  const [only] = summary.species
  const wholeSpecies = summary.species.length === 1 && isOnlyPlants(summary) && only!.selectedCount < only!.designCount
  return (
    <div className={styles.chip} role="group" aria-label={t('canvas.selectionChip.label')} data-selection-chip="bottom">
      <span className={styles.text} role="status" aria-live="polite">
        <b>{head}</b>
        {details.map((detail, index) => (
          <span key={index} className={detail.measure ? `${styles.muted} ${styles.measure}` : styles.muted}> · {detail.text}</span>
        ))}
      </span>
      {wholeSpecies && (
        <button
          type="button"
          className={styles.button}
          aria-keyshortcuts={SELECT_SAME_SPECIES.shortcuts?.[0] ? ariaKeyShortcuts(SELECT_SAME_SPECIES.shortcuts[0]) : undefined}
          onClick={() => currentCanvasSceneEditCommandSurface.value?.selectSameSpecies(only!.canonicalName)}
        >
          {t(SELECT_SAME_SPECIES.labelKey)}
        </button>
      )}
      <button
        type="button"
        className={styles.quiet}
        onClick={() => currentCanvasSceneEditCommandSurface.value?.clearSelection()}
      >
        {t('canvas.selectionChip.clear')}
      </button>
    </div>
  )
}

/** One part after the head; a measure never breaks inside ("0.52 m apart"). */
interface ChipDetail {
  readonly text: string
  readonly measure?: boolean
}

const ZONE_TYPE_KEYS: Readonly<Record<string, string>> = {
  rect: 'canvas.selectionChip.zoneRect',
  ellipse: 'canvas.selectionChip.zoneEllipse',
  polygon: 'canvas.selectionChip.zonePolygon',
  line: 'canvas.selectionChip.zoneLine',
}
const NOTE_PREVIEW_GRAPHEMES = 40

function isOnlyPlants(summary: MapSelectionSummary): boolean {
  return summary.zones.length === 0 && summary.noteCount === 0 && summary.measurementCount === 0
}

function describe(summary: MapSelectionSummary, activeLocale: string): { head: string; details: ChipDetail[] } {
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
    const head = zone.name === null
      ? t(ZONE_TYPE_KEYS[zone.zoneType] ?? 'canvas.selectionChip.zone')
      : t('canvas.selectionChip.zone')
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

/** Lengths as the map labels them: two decimals below 1 m, one below 100 m, none above. */
export function formatLength(meters: number, activeLocale: string): string {
  const digits = meters < 1 ? 2 : meters < 100 ? 1 : 0
  return new Intl.NumberFormat(activeLocale, { style: 'unit', unit: 'meter', unitDisplay: 'short', maximumFractionDigits: digits }).format(meters)
}

/** Areas in m² (one decimal below 10 m²), or in hectares from 1 ha. */
export function formatArea(squareMeters: number, activeLocale: string): string {
  if (squareMeters >= 10_000) {
    return new Intl.NumberFormat(activeLocale, { style: 'unit', unit: 'hectare', unitDisplay: 'short', maximumFractionDigits: 2 }).format(squareMeters / 10_000)
  }
  // Intl has no square-metre unit; the symbol m² is the same in every interface language.
  const value = new Intl.NumberFormat(activeLocale, { maximumFractionDigits: squareMeters < 10 ? 1 : 0 }).format(squareMeters)
  return `${value}\u00a0m²`
}
