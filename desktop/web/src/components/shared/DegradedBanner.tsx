import { plantDbStatus } from '../../app/shell/state'
import { t } from '../../i18n'
import styles from './DegradedBanner.module.css'

export function DegradedBanner() {
  const status = plantDbStatus.value
  if (status === 'available') return null

  const message = status === 'missing'
    ? t('health.plantDbMissing')
    : t('health.plantDbCorrupt')

  return (
    <div className={styles.banner} role="alert">
      {message}
    </div>
  )
}
