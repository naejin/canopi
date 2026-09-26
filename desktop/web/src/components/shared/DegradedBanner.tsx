import { plantDbStatus } from '../../app/health/state'
import { t } from '../../i18n'
import { Notice } from './Notice'
import styles from './DegradedBanner.module.css'

export function DegradedBanner() {
  const status = plantDbStatus.value
  if (status === 'available') return null

  const message = status === 'missing'
    ? t('health.plantDbMissing')
    : t('health.plantDbCorrupt')

  return (
    // Plant search is unavailable in both cases, so this is an error, announced as an alert.
    <Notice tone="error" className={styles.banner}>
      {message}
    </Notice>
  )
}
