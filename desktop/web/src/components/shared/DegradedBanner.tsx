import { useLayoutEffect, useRef } from 'preact/hooks'
import { plantDbStatus } from '../../app/health/state'
import { t } from '../../i18n'
import { Notice } from './Notice'
import { useMapOccluder } from './useMapChrome'
import styles from './DegradedBanner.module.css'

export function DegradedBanner() {
  const status = plantDbStatus.value
  if (status === 'available') return null

  const message = status === 'missing'
    ? t('health.plantDbMissing')
    : t('health.plantDbCorrupt')

  return <DegradedNotice message={message} />
}

/**
 * A row of its own below the title bar. Everything that starts under the title
 * bar (rails, dock, tool cards, chips, the start screen) is placed from
 * `--chrome-rail-top`, so the notice lowers that line on its container while it
 * shows instead of covering controls.
 */
function DegradedNotice({ message }: { readonly message: string }) {
  const ref = useRef<HTMLDivElement>(null)
  // Fits and chips keep below it too.
  useMapOccluder(ref, 'top')

  useLayoutEffect(() => {
    const notice = ref.current
    const host = notice?.parentElement
    if (!notice || !host) return
    const reserve = () => {
      host.style.setProperty('--chrome-rail-top', `calc(${notice.offsetTop + notice.offsetHeight}px + var(--space-2))`)
    }
    reserve()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reserve)
    observer?.observe(notice)
    return () => {
      observer?.disconnect()
      host.style.removeProperty('--chrome-rail-top')
    }
  }, [])

  return (
    <div ref={ref} className={styles.banner}>
      {/* Plant search is unavailable in both cases, so this is an error, announced as an alert. */}
      <Notice tone="error" className={styles.notice}>
        {message}
      </Notice>
    </div>
  )
}
