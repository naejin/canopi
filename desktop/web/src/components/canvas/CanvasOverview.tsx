import { currentCanvasQuerySurface, currentCanvasViewportCommandSurface } from '../../canvas/session'
import { useSavedLocationPresentation } from '../../app/location'
import { t } from '../../i18n'
import styles from '../panels/Panels.module.css'

const MARKER_EDGE_MARGIN_PX = 24

export function CanvasOverview() {
  const frame = currentCanvasQuerySurface.value?.viewport.value
  const location = useSavedLocationPresentation()
  if (!frame || frame.mode !== 'overview') return null

  const marker = { x: frame.viewport.x, y: frame.viewport.y }
  const markerVisible = marker.x >= MARKER_EDGE_MARGIN_PX
    && marker.x <= frame.screenSize.width - MARKER_EDGE_MARGIN_PX
    && marker.y >= MARKER_EDGE_MARGIN_PX
    && marker.y <= frame.screenSize.height - MARKER_EDGE_MARGIN_PX
  const provisional = location.placementStatus !== 'confirmed'
  const returnToDesign = () => currentCanvasViewportCommandSurface.value?.returnToDesign()

  return (
    <>
      <div className={styles.overviewNotice} role="status" aria-live="polite">
        <span className={styles.overviewNoticeText}>
          {provisional ? t('canvas.overview.provisional') : t('canvas.overview.zoomInToEdit')}
        </span>
        <button type="button" className={styles.overviewReturn} onClick={returnToDesign}>
          {t('canvas.overview.returnToDesign')}
        </button>
      </div>
      {markerVisible && (
        <button
          type="button"
          className={styles.overviewMarker}
          style={{ left: `${marker.x}px`, top: `${marker.y}px` }}
          aria-label={provisional
            ? t('canvas.overview.provisionalMarker')
            : t('canvas.overview.designMarker')}
          onClick={returnToDesign}
        >
          <span className={styles.overviewMarkerDot} aria-hidden="true" />
          <span>{provisional
            ? t('canvas.overview.provisionalDesign')
            : t('canvas.overview.design')}</span>
        </button>
      )}
    </>
  )
}
