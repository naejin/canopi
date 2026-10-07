import { useRef } from 'preact/hooks'
import { canvasCommandDefinitions } from '../../app/canvas-commands'
import { useMapSelectionSummary, type MapSelectionSummary } from '../../app/map-selection/summary'
import { describeMapSelection } from '../../app/map-selection/summary-text'
import { ariaKeyShortcuts } from '../../app/shell-commands/shortcut-text'
import { loneEditableZoneId, openRenameZoneDialog } from '../../app/rename-zone/state'
import { currentCanvasQuerySurface, currentCanvasSceneEditCommandSurface } from '../../canvas/session'
import { locale } from '../../app/settings/state'
import { t } from '../../i18n'
import { SpeciesCommonName } from '../shared/SpeciesIdentity'
import styles from './SelectionChip.module.css'

/**
 * The bottom status chip that names the map selection ("Apricot", "12 plants ·
 * 3 species · 0.52 m apart", "Zone · Z04 · 118 m² · 46 m", "Rectangle zone ·
 * 120 m² · 44 m") in the visible map area, above the view chip and
 * the zoom group, so it never meets the top finder chip. It reads the
 * selection through read-only runtime queries and offers Select all of this
 * species, Rename… for a lone zone and Clear selection; the rest lives in the
 * right-click menu.
 *
 * A button acts on a click whose press began on it, or on a keyboard or
 * assistive click (detail 0). A finger's tap on the map finishes a zone or
 * selects at its lift, so the chip can appear under the finger, and the click
 * the browser then makes from the tap lands on whatever is there.
 */
const SELECT_SAME_SPECIES = canvasCommandDefinitions.find((definition) =>
  definition.kind === 'edit' && definition.id === 'select-same-species')!

export function SelectionChip() {
  const summary = useMapSelectionSummary()
  const queries = currentCanvasQuerySurface.value
  const overview = queries?.view.mode.value === 'overview'
  if (!summary || overview) return null
  const { head, headEnglishFallback, details } = describeMapSelection(summary, locale.value)
  const [only] = summary.species
  const wholeSpecies = summary.species.length === 1 && isOnlyPlants(summary) && only!.selectedCount < only!.designCount
  // The summary hook re-renders the chip on selection and scene changes (locks included).
  const renameZoneId = loneEditableZoneId(queries?.getDesignObjectSelection() ?? null)
  const pressedButton = useRef<EventTarget | null>(null)
  const act = (run: () => void) => (event: MouseEvent) => {
    const pressedHere = pressedButton.current === event.currentTarget
    pressedButton.current = null
    if (event.detail === 0 || pressedHere) run()
  }
  return (
    <div
      className={styles.chip}
      role="group"
      aria-label={t('canvas.selectionChip.label')}
      data-selection-chip="bottom"
      onPointerDown={(event) => { pressedButton.current = (event.target as Element).closest('button') }}
      onPointerCancel={() => { pressedButton.current = null }}
      // A press that slid off its button ends in a click on the chip: no press is left for a later click.
      onClick={() => { pressedButton.current = null }}
    >
      <span className={styles.text} role="status" aria-live="polite">
        <b><SpeciesCommonName name={head} englishFallback={headEnglishFallback} /></b>
        {details.map((detail, index) => (
          <span key={index} className={detail.measure ? `${styles.muted} ${styles.measure}` : styles.muted}>
            {' · '}<SpeciesCommonName name={detail.text} englishFallback={detail.englishFallback} />
          </span>
        ))}
      </span>
      {wholeSpecies && (
        <button
          type="button"
          className={styles.button}
          aria-keyshortcuts={SELECT_SAME_SPECIES.shortcuts?.[0] ? ariaKeyShortcuts(SELECT_SAME_SPECIES.shortcuts[0]) : undefined}
          onClick={act(() => currentCanvasSceneEditCommandSurface.value?.selectSpecies([only!.canonicalName]))}
        >
          {t(SELECT_SAME_SPECIES.labelKey)}
        </button>
      )}
      {renameZoneId !== null && (
        <button
          type="button"
          className={styles.button}
          aria-haspopup="dialog"
          onClick={act(() => openRenameZoneDialog({
            zoneId: renameZoneId,
            name: summary.zones[0]?.name ?? null,
            rename: (zoneId, name) => currentCanvasSceneEditCommandSurface.value?.renameZone(zoneId, name),
          }))}
        >
          {t('canvas.selectionChip.rename')}
        </button>
      )}
      <button
        type="button"
        className={styles.quiet}
        onClick={act(() => currentCanvasSceneEditCommandSurface.value?.clearSelection())}
      >
        {t('canvas.selectionChip.clear')}
      </button>
    </div>
  )
}

function isOnlyPlants(summary: MapSelectionSummary): boolean {
  return summary.zones.length === 0 && summary.noteCount === 0 && summary.measurementCount === 0
}
