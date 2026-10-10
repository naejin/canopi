import { useEffect, useRef, useState } from 'preact/hooks'
import { plantLabelCoverage, zoomInForPlantLabels } from '../../app/plant-display/coverage'
import { currentPlantDisplay } from '../../app/plant-display/state'
import { plantFinderMapMatches } from '../../app/plant-finder/map-matches'
import { currentCanvasQuerySurface } from '../../canvas/session'
import styles from './SpeciesFocusChip.module.css'

/** How long the chip stays after View › Labels (N) changes. */
export const PLANT_LABELS_CHIP_MS = 4000

/**
 * After the labels change (N, View › Labels or the panel), a top chip says how
 * many plants in view carry one: "Codes shown for 70 of 282 plants in view".
 * The highlight chip wins the same place while plants are highlighted.
 */
export function PlantLabelsChip() {
  const labels = currentPlantDisplay.value.labels
  const previous = useRef(labels)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (previous.current === labels) return
    previous.current = labels
    setVisible(true)
    const timer = globalThis.setTimeout(() => setVisible(false), PLANT_LABELS_CHIP_MS)
    return () => globalThis.clearTimeout(timer)
  }, [labels])
  if (!visible) return null
  const queries = currentCanvasQuerySurface.value
  if (!queries || queries.getSpeciesFocus().canonicalName || plantFinderMapMatches.value) return null
  const coverage = plantLabelCoverage()
  if (!coverage) return null
  return (
    <div className={styles.chip} data-plant-labels-chip>
      <span className={styles.text} role="status">{coverage.text}</span>
      {coverage.zoomIn && (
        <button type="button" className={styles.button} onClick={zoomInForPlantLabels}>{coverage.zoomIn}</button>
      )}
    </div>
  )
}
