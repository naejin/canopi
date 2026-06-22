import { plantColorByAttr, plantSizeMode } from '../../canvas/plant-display-state'
import { locale } from '../../app/settings/state'
import { getLegendEntries } from '../../canvas/display-modes'
import { buildPinnedPlantNameLegendEntries } from '../../canvas/pinned-plant-name-legend'
import { SCALE_BAR_RESERVED_BOTTOM_PX } from '../../canvas/scale-bar'
import { currentCanvasQuerySurface } from '../../canvas/session'
import { t } from '../../i18n'
import { PlantSymbolGlyph } from './PlantSymbolGlyph'
import styles from './DisplayLegend.module.css'

export function DisplayLegend() {
  void locale.value
  const attr = plantColorByAttr.value
  const sizeMode = plantSizeMode.value
  const querySurface = currentCanvasQuerySurface.value
  void querySurface?.revision.scene.value
  void querySurface?.revision.plantNames.value

  if (attr === null) {
    if (sizeMode !== 'default' || !querySurface) return null

    const pinnedEntries = buildPinnedPlantNameLegendEntries(querySurface)
    if (pinnedEntries.length === 0) return null

    return (
      <div
        className={styles.legend}
        style={{ bottom: `${SCALE_BAR_RESERVED_BOTTOM_PX}px` }}
        data-pinned-plant-name-legend
      >
        <div className={styles.title}>{t('canvas.display.legend')}</div>
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

  const entries = getLegendEntries(attr)

  return (
    <div className={styles.legend} style={{ bottom: `${SCALE_BAR_RESERVED_BOTTOM_PX}px` }}>
      <div className={styles.title}>{t('canvas.display.legend')}</div>
      <div className={styles.entries}>
        {entries.map((e) => (
          <div key={e.label} className={styles.entry}>
            <span className={styles.dot} style={{ backgroundColor: e.color }} />
            <span className={styles.entryLabel}>{e.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
