import { plantColorByAttr } from '../../state/canvas'
import { locale } from '../../app/settings/state'
import { getLegendEntries } from '../../canvas/display-modes'
import { SCALE_BAR_RESERVED_BOTTOM_PX } from '../../canvas/scale-bar'
import { t } from '../../i18n'
import styles from './DisplayLegend.module.css'

export function DisplayLegend() {
  void locale.value
  const attr = plantColorByAttr.value

  if (attr === null) return null

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
