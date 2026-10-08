import { useEffect } from 'preact/hooks'
import { LayerPanel } from '../canvas/LayerPanel'
import { readCanvasLayerPresentation } from '../../app/canvas-layer-presentation/presentation'
import { LAYER_PANEL_ACTIONS } from '../../app/canvas-layer-presentation/panel-actions'
import { installLidarLibraryObserver } from '../../app/lidar/library-store'

/**
 * Desktop Layers: the shared panel. The Design's site data has its own panel
 * (SiteDataPanel); Layers keeps the library snapshot current for the Site
 * data summary row.
 */
export function LayersPanel() {
  useEffect(() => installLidarLibraryObserver(), [])
  return <LayerPanel rows={readCanvasLayerPresentation().rows} actions={LAYER_PANEL_ACTIONS} />
}
