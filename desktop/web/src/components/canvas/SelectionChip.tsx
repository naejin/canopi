import { canvasCommandDefinitions } from '../../app/canvas-commands'
import { useMapSelectionSummary, type MapSelectionSummary } from '../../app/map-selection/summary'
import { describeMapSelection } from '../../app/map-selection/summary-text'
import { ariaKeyShortcuts } from '../../app/shell-commands/shortcut-text'
import { currentCanvasQuerySurface, currentCanvasSceneEditCommandSurface } from '../../canvas/session'
import { locale } from '../../app/settings/state'
import { t } from '../../i18n'
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
  const { head, details } = describeMapSelection(summary, locale.value)
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

function isOnlyPlants(summary: MapSelectionSummary): boolean {
  return summary.zones.length === 0 && summary.noteCount === 0 && summary.measurementCount === 0
}
