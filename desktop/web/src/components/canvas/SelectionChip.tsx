import { canvasCommandDefinitions } from '../../app/canvas-commands'
import { useMapSelectionSummary, type MapSelectionSummary } from '../../app/map-selection/summary'
import { ariaKeyShortcuts } from '../../app/shell-commands/shortcut-text'
import { currentCanvasQuerySurface, currentCanvasSceneEditCommandSurface } from '../../canvas/session'
import { t } from '../../i18n'
import styles from './SelectionChip.module.css'

/**
 * The bottom status chip that names the map selection ("Apricot", "12 plants ·
 * 3 species", "Zone · Z04") in the visible map area, above the view chip and
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
  const { head, details } = describe(summary)
  const [only] = summary.species
  const wholeSpecies = summary.species.length === 1 && isOnlyPlants(summary) && only!.selectedCount < only!.designCount
  return (
    <div className={styles.chip} role="group" aria-label={t('canvas.selectionChip.label')} data-selection-chip="bottom">
      <span className={styles.text} role="status" aria-live="polite">
        <b>{head}</b>
        {details.map((detail) => <span key={detail} className={styles.muted}> · {detail}</span>)}
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

function isOnlyPlants(summary: MapSelectionSummary): boolean {
  return summary.zoneNames.length === 0 && summary.noteCount === 0 && summary.measurementCount === 0
}

function describe(summary: MapSelectionSummary): { head: string; details: string[] } {
  const { plantCount, species, zoneNames, noteCount, measurementCount } = summary
  const zoneCount = zoneNames.length
  const kinds = [plantCount, zoneCount, noteCount, measurementCount].filter((count) => count > 0).length
  if (kinds > 1) {
    return {
      head: t('canvas.selectionChip.selected', { count: plantCount + zoneCount + noteCount + measurementCount }),
      details: [
        plantCount > 0 ? t('canvas.selectionChip.plants', { count: plantCount }) : '',
        zoneCount > 0 ? t('canvas.selectionChip.zones', { count: zoneCount }) : '',
        noteCount > 0 ? t('canvas.selectionChip.notes', { count: noteCount }) : '',
        measurementCount > 0 ? t('canvas.selectionChip.measurements', { count: measurementCount }) : '',
      ].filter(Boolean),
    }
  }
  if (plantCount > 0) {
    if (plantCount === 1) return { head: species[0]!.name, details: [] }
    return {
      head: t('canvas.selectionChip.plants', { count: plantCount }),
      details: [species.length === 1 ? species[0]!.name : t('canvas.selectionChip.species', { count: species.length })],
    }
  }
  if (zoneCount === 1) return { head: t('canvas.selectionChip.zone'), details: [zoneNames[0]!] }
  if (zoneCount > 1) return { head: t('canvas.selectionChip.zones', { count: zoneCount }), details: [] }
  if (noteCount > 0) return { head: t('canvas.selectionChip.notes', { count: noteCount }), details: [] }
  return { head: t('canvas.selectionChip.measurements', { count: measurementCount }), details: [] }
}
