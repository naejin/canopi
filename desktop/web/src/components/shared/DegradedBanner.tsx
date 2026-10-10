import { useRef } from 'preact/hooks'
import { lidarLibraryStatus, localDataStatus, plantDbStatus } from '../../app/health/state'
import { t } from '../../i18n'
import { Notice } from './Notice'
import { useChromeRow } from './useMapChrome'
import { useModalInertRegion } from './useModalLayer'
import styles from './DegradedBanner.module.css'

/**
 * One line per subsystem that is unusable for the session: the plant catalog
 * when its database is missing or damaged, the Data library when it is refused
 * or could not be opened. A recovered library is not degraded and is explained
 * in the Data library itself. On the start that moved local data from before
 * Canopi 2.0 aside (ADR 0021), one dismissible line says so.
 */
export function DegradedBanner() {
  const messages: string[] = []
  const plantDb = plantDbStatus.value
  if (plantDb === 'missing') messages.push(t('health.plantDbMissing'))
  if (plantDb === 'corrupt') messages.push(t('health.plantDbCorrupt'))
  const library = lidarLibraryStatus.value.kind
  if (library === 'refused_newer') messages.push(t('canvas.lidar.library.refusedNewer'))
  if (library === 'unavailable') messages.push(t('canvas.lidar.library.unavailable'))
  const movedAside = localDataStatus.value.kind === 'moved_aside'
  if (messages.length === 0 && !movedAside) return null

  return <DegradedNotice messages={messages} movedAside={movedAside} />
}

/** A row of its own below the title bar (`useChromeRow`). */
function DegradedNotice({ messages, movedAside }: {
  readonly messages: readonly string[]
  readonly movedAside: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useChromeRow(ref)
  useModalInertRegion(ref)

  return (
    <div ref={ref} className={styles.banner}>
      {/* Each subsystem is unavailable for the session, so every line is an error, announced as an alert. */}
      {messages.map((message) => (
        <Notice key={message} tone="error" className={styles.notice}>
          {message}
        </Notice>
      ))}
      {movedAside && (
        <Notice
          tone="info"
          className={styles.notice}
          action={(
            <button
              type="button"
              className={styles.dismiss}
              onClick={() => { localDataStatus.value = { kind: 'current' } }}
            >
              {t('health.dismiss')}
            </button>
          )}
        >
          {t('health.localDataMovedAside')}
        </Notice>
      )}
    </div>
  )
}
