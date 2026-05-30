import { InteractiveTimeline } from './InteractiveTimeline'
import styles from './TimelineTab.module.css'

export function TimelineTab() {
  return (
    <div className={styles.container}>
      <div className={styles.canvasArea}>
        <InteractiveTimeline />
      </div>
    </div>
  )
}
