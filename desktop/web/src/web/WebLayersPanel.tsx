import { LayerPanel } from '../components/canvas/LayerPanel'
import { Notice } from '../components/shared/Notice'
import { LAYER_PANEL_ACTIONS } from '../app/canvas-layer-presentation/panel-actions'
import { readCanvasLayerPresentation } from '../app/canvas-layer-presentation/presentation'
import { currentDesign } from '../app/document-session/store'
import { t } from '../i18n'
import styles from './web-layers-panel.module.css'

/** Web has no local terrain or LiDAR: its map rows are the Background (Satellite, Map or None). */
const WEB_REFERENCE_ROWS: ReadonlySet<string> = new Set(['basemap', 'satellite'])

/**
 * Web Layers. Site data states why it is empty: terrain and height data need
 * Canopi Desktop. A Design's references to them round-trip unchanged and show
 * again there.
 */
export function WebLayersPanel() {
  const rows = readCanvasLayerPresentation().rows.filter((row) =>
    row.authority === 'scene' || WEB_REFERENCE_ROWS.has(row.id))
  const kept = currentDesign.value?.lidar?.entries.length ?? 0
  return (
    <LayerPanel
      rows={rows}
      actions={LAYER_PANEL_ACTIONS}
      siteData={(
        <div className={styles.notice}>
          <Notice tone="info">
            {kept > 0 ? t('canvas.lidar.webKept', { count: kept }) : t('canvas.lidar.webUnavailable')}
          </Notice>
        </div>
      )}
    />
  )
}
