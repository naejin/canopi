import { useRef } from 'preact/hooks'
import { plantDbStatus } from '../../app/health/state'
import { t } from '../../i18n'
import { Notice } from './Notice'
import { useChromeRow } from './useMapChrome'
import { useModalInertRegion } from './useModalLayer'
import styles from './DegradedBanner.module.css'

export function DegradedBanner() {
  const status = plantDbStatus.value
  if (status === 'available') return null

  const message = status === 'missing'
    ? t('health.plantDbMissing')
    : t('health.plantDbCorrupt')

  return <DegradedNotice message={message} />
}

/** A row of its own below the title bar (`useChromeRow`). */
function DegradedNotice({ message }: { readonly message: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useChromeRow(ref)
  useModalInertRegion(ref)

  return (
    <div ref={ref} className={styles.banner}>
      {/* Plant search is unavailable in both cases, so this is an error, announced as an alert. */}
      <Notice tone="error" className={styles.notice}>
        {message}
      </Notice>
    </div>
  )
}
