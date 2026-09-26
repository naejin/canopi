import { designName } from '../../app/document-session/store'
import { currentCanvasQuerySurface, currentCanvasViewportCommandSurface } from '../../canvas/session'
import { t } from '../../i18n'
import { visibleDesignName } from '../shared/DesignNameField'
import { ControlIcon } from '../shared/ControlIcon'
import styles from './CanvasOverview.module.css'

const MARKER_EDGE_MARGIN_PX = 24

/**
 * Overview (below 0.1 px/m): a top-centre chip explains that plants are
 * hidden and offers the one Return to Design action; the Design shows as a
 * named pin at its origin.
 */
export function CanvasOverview() {
  const frame = currentCanvasQuerySurface.value?.viewport.value
  if (!frame || frame.mode !== 'overview') return null

  const marker = { x: frame.viewport.x, y: frame.viewport.y }
  const markerVisible = marker.x >= MARKER_EDGE_MARGIN_PX
    && marker.x <= frame.screenSize.width - MARKER_EDGE_MARGIN_PX
    && marker.y >= MARKER_EDGE_MARGIN_PX
    && marker.y <= frame.screenSize.height - MARKER_EDGE_MARGIN_PX
  const name = visibleDesignName(designName.value)

  return (
    <>
      <div className={styles.notice} role="status" aria-live="polite" data-overview-notice>
        <span className={styles.noticeText}>{t('canvas.overview.zoomInToEdit')}</span>
        <button
          type="button"
          className={styles.returnButton}
          onClick={() => currentCanvasViewportCommandSurface.value?.returnToDesign()}
        >
          {t('canvas.overview.returnToDesign')}
        </button>
      </div>
      {markerVisible && (
        <div
          className={styles.pin}
          style={{ left: `${marker.x}px`, top: `${marker.y}px` }}
          role="img"
          aria-label={t('canvas.overview.designPin', { name })}
          data-overview-pin
        >
          <span className={styles.pinDot} aria-hidden="true"><ControlIcon name="pin" /></span>
          <span className={styles.pinName} aria-hidden="true">{name}</span>
        </div>
      )}
    </>
  )
}
