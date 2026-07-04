import { locale } from '../../app/settings/state'
import { buildPinnedPlantNameLegendEntries } from '../../canvas/pinned-plant-name-legend'
import { SCALE_BAR_RESERVED_BOTTOM_PX } from '../../canvas/scale-bar'
import { currentCanvasQuerySurface } from '../../canvas/session'
import { t } from '../../i18n'
import { PlantSymbolGlyph } from './PlantSymbolGlyph'
import styles from './DisplayLegend.module.css'

const DISPLAY_LEGEND_TOP_RESERVED_PX = 32

export function DisplayLegend() {
  void locale.value
  const querySurface = currentCanvasQuerySurface.value
  void querySurface?.revision.scene.value
  void querySurface?.revision.plantNames.value

  if (!querySurface) return null

  const pinnedEntries = buildPinnedPlantNameLegendEntries(querySurface)
  if (pinnedEntries.length === 0) return null

  return (
    <div
      className={styles.legend}
      style={getLegendStyle()}
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
              <PlantSymbolGlyph symbol={entry.symbol} className={styles.symbolGlyph} />
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

function getLegendStyle() {
  return {
    bottom: `${SCALE_BAR_RESERVED_BOTTOM_PX}px`,
    maxHeight: `calc(100% - ${SCALE_BAR_RESERVED_BOTTOM_PX}px - ${DISPLAY_LEGEND_TOP_RESERVED_PX}px)`,
    overflowY: 'auto',
  }
}
