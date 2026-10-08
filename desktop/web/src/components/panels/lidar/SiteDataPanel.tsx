import { useEffect } from 'preact/hooks'
import { designSessionStore } from '../../../app/document-session/store'
import { openDataLibrary, siteDataDetails } from '../../../app/lidar/library-navigation'
import { installLidarLibraryObserver } from '../../../app/lidar/library-store'
import { siteDataViewFor } from '../../../app/lidar/site-data-view'
import { t } from '../../../i18n'
import { ButtonTooltip } from '../../shared/ButtonTooltip'
import { ControlIcon } from '../../shared/ControlIcon'
import { DockPanelHeader } from '../../shared/DockPanelHeader'
import { AddDataMenu, SiteDataInspector, SiteDataRows } from './SiteData'
import { SiteDataDetails } from './SiteDataDetails'
import styles from './site-data.module.css'

/**
 * The Site data panel (canopi-f47t.42, spec §1.10; Desktop, a Design panel):
 * the header with the Data library and close over the Design's site data.
 * Commit 0's skeleton: the toolbar and body still hold the Layers rows, Add
 * data and the open row's settings, so nothing is lost before stream B builds
 * the panel body. `importGeoJson` is File › Import GeoJSON, offered in Add
 * data until Add data goes.
 */
export function SiteDataPanel({ importGeoJson }: { readonly importGeoJson: () => void }) {
  useEffect(() => installLidarLibraryObserver(), [])
  const details = siteDataDetails.value
  if (details) return <SiteDataDetails id={details} />
  const view = siteDataViewFor(designSessionStore.sessionIdentity.value)
  const libraryLabel = t('canvas.lidar.library.title')
  return (
    <aside className={styles.panel} aria-label={t('canvas.layers.siteData')}>
      <DockPanelHeader
        title={t('canvas.layers.siteData')}
        actions={(
          <button type="button" className={styles.headerButton} aria-label={libraryLabel} onClick={() => openDataLibrary(view.openItem.value)}>
            <ControlIcon name="folder-open" size={18} />
            <ButtonTooltip label={libraryLabel} side="bottom" />
          </button>
        )}
      />
      <div className={styles.toolbar}><AddDataMenu importGeoJson={importGeoJson} /></div>
      <div className={styles.body}><SiteDataRows /></div>
      <SiteDataInspector />
    </aside>
  )
}
