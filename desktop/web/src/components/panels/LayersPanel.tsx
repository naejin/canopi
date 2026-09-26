import { useEffect } from 'preact/hooks'
import { LayerPanel } from '../canvas/LayerPanel'
import { LidarLayersSection } from './lidar/LidarLayersSection'
import { readCanvasLayerPresentation } from '../../app/canvas-layer-presentation/presentation'
import { LAYER_PANEL_ACTIONS } from '../../app/canvas-layer-presentation/panel-actions'
import { installLidarLibraryObserver } from '../../app/lidar/library-store'

/** Desktop Layers panel: the shared panel plus the Design's LiDAR items. */
export function LayersPanel() {
  useEffect(() => installLidarLibraryObserver(), [])
  return (
    <LayerPanel
      rows={readCanvasLayerPresentation().rows}
      referenceItems={<LidarLayersSection />}
      actions={LAYER_PANEL_ACTIONS}
    />
  )
}
