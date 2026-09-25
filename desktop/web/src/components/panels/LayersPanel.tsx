import { useEffect } from 'preact/hooks'
import { LayerPanel, type LayerPanelActions } from '../canvas/LayerPanel'
import { LidarLayersSection } from './lidar/LidarLayersSection'
import {
  readCanvasLayerPresentation,
  setCanvasLayerPresentationActiveLayer,
  setCanvasLayerPresentationVisibility,
  setCanvasLayerPresentationLocked,
  setCanvasLayerPresentationOpacity,
  setCanvasLayerPresentationContourIntervalMeters,
} from '../../app/canvas-layer-presentation/presentation'
import { saveGoogleMapsApiKey, setBasemapStyle, setSatelliteProvider } from '../../app/map-layers/actions'
import { installLidarLibraryObserver } from '../../app/lidar/library-store'

/** Layer actions shared by both editions' Layers panels. */
export const LAYER_PANEL_ACTIONS: LayerPanelActions = {
  active: setCanvasLayerPresentationActiveLayer,
  visibility: setCanvasLayerPresentationVisibility,
  locked: setCanvasLayerPresentationLocked,
  opacity: setCanvasLayerPresentationOpacity,
  contourInterval: setCanvasLayerPresentationContourIntervalMeters,
  basemapStyle: setBasemapStyle,
  satelliteProvider: setSatelliteProvider,
  saveGoogleKey: saveGoogleMapsApiKey,
}

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
