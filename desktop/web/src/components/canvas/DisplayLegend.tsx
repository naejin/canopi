import { buildPinnedPlantNameLegendEntries } from '../../canvas/pinned-plant-name-legend'
import { currentCanvasQuerySurface } from '../../canvas/session'
import { t } from '../../i18n'
import { PlantSymbolGlyph } from './PlantSymbolGlyph'
import styles from './DisplayLegend.module.css'

export function DisplayLegend() {
  const querySurface = currentCanvasQuerySurface.value
  void querySurface?.revision.scene.value
  void querySurface?.revision.plantNames.value

  if (!querySurface) return null

  const pinnedEntries = buildPinnedPlantNameLegendEntries(querySurface)
  if (pinnedEntries.length === 0) return null

  return (
    <div
      className={styles.legend}
      data-pinned-plant-name-legend
    >
      <div className={styles.title}>{t('canvas.pinnedPlantNames.legend')}</div>
      <div className={styles.entries}>
        {pinnedEntries.map((entry) => (
          <div
            key={`${entry.label}:${entry.symbol}:${entry.color}`}
            className={styles.entry}
            data-pinned-plant-name-entry
          >
            <span
              className={styles.symbolSwatch}
              style={{ color: entry.color }}
              aria-hidden="true"
            >
              <PlantSymbolGlyph symbol={entry.symbol} size={14} className={styles.symbolGlyph} />
            </span>
            <span className={styles.entryLabel}>{entry.label}</span>
            {entry.count > 1 && (
              <span className={styles.count} data-pinned-plant-name-count>
                {entry.count}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
