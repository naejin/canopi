import {
  currentCanvasQuerySurface,
  currentCanvasSceneEditCommandSurface,
  currentCanvasSpeciesFocusCommands,
} from '../../canvas/session'
import {
  clearPlantFinderSearch,
  countPlantsOfSpecies,
  plantFinderMapMatches,
  selectPlantFinderMatches,
  zoomToPlantFinderMatches,
} from '../../app/plant-finder/map-matches'
import { t } from '../../i18n'
import styles from './SpeciesFocusChip.module.css'

/**
 * The top chip for plants highlighted on the map: one species focused from "Plants in
 * this Design", or the finder's matches. Its actions never edit the Design.
 */
export function SpeciesFocusChip() {
  const queries = currentCanvasQuerySurface.value
  void queries?.revision.scene.value
  void queries?.revision.plantNames.value
  const matches = plantFinderMapMatches.value
  if (!queries) return null
  const scene = queries.getSceneSnapshot()
  const focused = queries.getSpeciesFocus().canonicalName
  if (focused) {
    const count = countPlantsOfSpecies(scene, [focused])
    const name = queries.getLocalizedCommonNames().get(focused)
      || scene.plants.find((plant) => plant.canonicalName === focused)?.commonName
      || focused
    return (
      <div className={styles.chip} role="group" aria-label={t('speciesKey.highlightedOnMap')}>
        <span className={styles.text} role="status">
          <b>{name}</b> <span className={styles.muted}>· {t('speciesKey.plantsHighlighted', { count })}</span>
        </span>
        <button type="button" className={styles.button}
          onClick={() => currentCanvasSceneEditCommandSurface.value?.selectSameSpecies(focused)}>
          {t('speciesKey.selectThese')}
        </button>
        <button type="button" className={styles.quiet} onClick={() => currentCanvasSpeciesFocusCommands.value?.focus(null)}>
          {t('speciesKey.clearHighlight')}
        </button>
      </div>
    )
  }
  if (!matches) return null
  const count = countPlantsOfSpecies(scene, matches.canonicalNames)
  if (count === 0) return null
  return (
    <div className={styles.chip} role="group" aria-label={t('speciesKey.highlightedOnMap')}>
      <span className={styles.text} role="status">
        {t('speciesKey.plantsMatch', { count, query: matches.query })}
      </span>
      <button type="button" className={styles.button} onClick={zoomToPlantFinderMatches}>
        {t('speciesKey.zoomToThem')}
      </button>
      <button type="button" className={`${styles.button} ${styles.primary}`} onClick={selectPlantFinderMatches}>
        {t('speciesKey.selectAll', { count })}
      </button>
      <button type="button" className={styles.quiet} onClick={clearPlantFinderSearch}>
        {t('speciesKey.clearHighlight')}
      </button>
    </div>
  )
}
