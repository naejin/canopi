import { zoomLevel, zoomReference } from '../../state/canvas'
import { canvasEngine } from '../../canvas/engine'
import { t } from '../../i18n'
import styles from './ZoomControls.module.css'

export function ZoomControls() {
  const zoom = zoomLevel.value

  return (
    <div className={styles.controls} role="group" aria-label={t('canvas.grid.zoom')}>
      <button
        className={styles.btn}
        type="button"
        onClick={() => canvasEngine?.zoomOut()}
        aria-label="Zoom out"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <span className={styles.level}>{Math.round((zoom / zoomReference.value) * 100)}%</span>
      <button
        className={styles.btn}
        type="button"
        onClick={() => canvasEngine?.zoomIn()}
        aria-label="Zoom in"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className={styles.btn}
        type="button"
        onClick={() => canvasEngine?.zoomToFit()}
        aria-label="Fit to content"
        title="Fit to content"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}
