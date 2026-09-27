import { currentCanvasQuerySurface } from '../../canvas/session'
import { t } from '../../i18n'
import { currentPlantDisplay } from './state'

/**
 * How many plants in view carry a label, as a sentence ("Codes shown for 70
 * of 282 plants in view"), or null with no plants in view. Reads the camera
 * frame, so a component calling it re-renders as the map moves.
 */
export function plantLabelCoverageText(): string | null {
  const queries = currentCanvasQuerySurface.value
  if (!queries) return null
  void queries.viewport.value
  void queries.revision.scene.value
  void queries.revision.plantNames.value
  const labels = currentPlantDisplay.value.labels
  const { labelled, inView } = queries.getPlantLabelCoverage()
  if (inView === 0) return null
  if (labels === 'none') return t('speciesKey.labelsOff')
  return t(labels === 'codes' ? 'speciesKey.codesShown' : 'speciesKey.namesShown', { count: inView, shown: labelled })
}
