import {
  currentCanvasQuerySurface,
  currentCanvasSpeciesFocusCommands,
} from '../../canvas/session'
import { t } from '../../i18n'
import styles from './SpeciesFocusChip.module.css'

export function SpeciesFocusChip() {
  const queries = currentCanvasQuerySurface.value
  void queries?.revision.scene.value
  const canonicalName = queries?.getSpeciesFocus().canonicalName
  if (!queries || !canonicalName) return null
  const scene = queries.getSceneSnapshot()
  const count = scene.plants.filter(
    (plant) => plant.canonicalName === canonicalName,
  ).length
  const code = scene.plantSpeciesCodes[canonicalName] ?? canonicalName
  return (
    <button
      type="button"
      className={styles.chip}
      aria-label={`${t('speciesKey.clear')}: ${canonicalName}`}
      title={canonicalName}
      onClick={() => currentCanvasSpeciesFocusCommands.value?.focus(null)}
    >
      <span>{t('speciesKey.focus', { code })}</span>
      <span className={styles.count}>{count}</span>
      <span aria-hidden="true">×</span>
    </button>
  )
}
