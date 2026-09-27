import { currentCanvasQuerySurface, getCurrentCanvasCommandSurface } from '../../canvas/session'
import { t } from '../../i18n'
import { PLANT_LABEL_MIN_SCALE } from '../../canvas/runtime/plant-display'
import { currentPlantDisplay } from './state'

export interface PlantLabelCoverageLine {
  /** "Codes shown for 70 of 282 plants in view", or "Labels are off". */
  readonly text: string
  /**
   * "Zoom in to see names" when labels are on but none shows at this zoom;
   * null otherwise. `zoomInForPlantLabels()` is its action.
   */
  readonly zoomIn: string | null
}

/**
 * How many plants in view carry a label, or null with no plants in view.
 * Reads the camera frame, so a component calling it re-renders as the map
 * moves.
 */
export function plantLabelCoverage(): PlantLabelCoverageLine | null {
  const queries = currentCanvasQuerySurface.value
  if (!queries) return null
  void queries.viewport.value
  void queries.revision.scene.value
  void queries.revision.plantNames.value
  const labels = currentPlantDisplay.value.labels
  const { labelled, inView } = queries.getPlantLabelCoverage()
  if (inView === 0) return null
  if (labels === 'none') return { text: t('speciesKey.labelsOff'), zoomIn: null }
  const codes = labels === 'codes'
  // A hidden Plants layer has no plants in view, so a zero here is the zoom's.
  return {
    text: t(codes ? 'speciesKey.codesShown' : 'speciesKey.namesShown', { count: inView, shown: labelled }),
    zoomIn: labelled === 0 ? t(codes ? 'speciesKey.zoomInForCodes' : 'speciesKey.zoomInForNames') : null,
  }
}

/**
 * The zoom-in action beside "Names shown for 0 of … plants in view", camera
 * only: straight to the scale where labels start to show, or one step when the
 * map is already there and plants are too close for their labels.
 */
export function zoomInForPlantLabels(): void {
  const commands = getCurrentCanvasCommandSurface()
  const queries = currentCanvasQuerySurface.peek()
  const labels = currentPlantDisplay.peek().labels
  if (!commands || !queries || labels === 'none') return
  const scale = queries.viewport.peek().viewport.scale
  // A little past the threshold, so rounding never leaves the map just short of it.
  const factor = PLANT_LABEL_MIN_SCALE[labels] * 1.05 / scale
  if (Number.isFinite(factor) && factor > 1) commands.viewport.zoomBy(factor)
  else commands.viewport.zoomIn()
}
