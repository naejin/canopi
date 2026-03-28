import { plantDisplayMode, plantColorByAttr } from '../../state/canvas'
import { getLegendEntries } from '../../canvas/display-modes'
import { t } from '../../i18n'
import styles from './DisplayLegend.module.css'

export function DisplayLegend() {
  const mode = plantDisplayMode.value
  const attr = plantColorByAttr.value

  if (mode !== 'color-by') return null

  const entries = getLegendEntries(attr)

  return (
    <div className={styles.legend}>
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
