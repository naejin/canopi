import { DockPanelHeader } from '../components/shared/DockPanelHeader'
import { t } from '../i18n'
import styles from './web-local-raster-panel.module.css'

/**
 * The Web Edition's raster surface.
 *
 * Web preserves a Design's dataset and result references and round-trips them,
 * but it renders and processes no local raster assets. This surface states that
 * honestly instead of offering controls that cannot work, and it never reaches
 * native geocoding or Tauri.
 */
export function WebLocalRasterPanel({ title }: { readonly title: string }) {
  return (
    <div className={styles.panel}>
      <DockPanelHeader title={title} />
      <div className={styles.body}>
        <p className={styles.message}>{t('canvas.lidar.webUnavailable')}</p>
      </div>
    </div>
  )
}
