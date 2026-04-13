import { currentDesign } from '../../state/document'
import { t } from '../../i18n'
import { northBearingDeg } from '../../state/canvas'
import styles from './CompassOverlay.module.css'

export function CompassOverlay() {
  const design = currentDesign.value
  if (!design?.location || design.north_bearing_deg == null) return null

  const bearing = northBearingDeg.value

  return (
    <div
      className={styles.compass}
      role="img"
      aria-label={`${t('canvas.grid.compass')}: ${Math.round(bearing)}°`}
      title={`${t('canvas.grid.compass')}: ${Math.round(bearing)}°`}
    >
      <svg className={styles.dial} viewBox="0 0 40 40" aria-hidden="true">
        <circle className={styles.ring} cx="20" cy="20" r="18" />
        <g
          className={styles.needle}
          style={{ transform: `rotate(${bearing}deg)` }}
        >
          <path className={styles.needleNorth} d="M20 4 L24 19 L20 16 L16 19 Z" />
          <path className={styles.needleSouth} d="M20 36 L16 21 L20 24 L24 21 Z" />
        </g>
        <text className={styles.northLabel} x="20" y="11" textAnchor="middle">
          {t('canvas.grid.north')}
        </text>
      </svg>
    </div>
  )
}
