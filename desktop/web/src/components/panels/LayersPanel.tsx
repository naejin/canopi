import { useEffect } from 'preact/hooks'
import { LayerPanel } from '../canvas/LayerPanel'
import { AddDataMenu, SiteDataInspector, SiteDataRows } from './lidar/SiteData'
import { SiteDataDetails } from './lidar/SiteDataDetails'
import { readCanvasLayerPresentation } from '../../app/canvas-layer-presentation/presentation'
import { LAYER_PANEL_ACTIONS } from '../../app/canvas-layer-presentation/panel-actions'
import { siteDataDetails } from '../../app/lidar/library-navigation'
import { installLidarLibraryObserver } from '../../app/lidar/library-store'

/**
 * Desktop Layers: the shared panel with the Design's site data (terrain and
 * height items, their results nested under them, and Add data), or one site
 * item's details. `importGeoJson` is the File › Import GeoJSON command, offered
 * again in Add data.
 */
export function LayersPanel({ importGeoJson }: { readonly importGeoJson: () => void }) {
  useEffect(() => installLidarLibraryObserver(), [])
  const details = siteDataDetails.value
  if (details) return <SiteDataDetails id={details} />
  return (
    <LayerPanel
      rows={readCanvasLayerPresentation().rows}
      actions={LAYER_PANEL_ACTIONS}
      siteData={<SiteDataRows />}
      siteAction={<AddDataMenu importGeoJson={importGeoJson} />}
      siteFooter={<SiteDataInspector />}
    />
  )
}
