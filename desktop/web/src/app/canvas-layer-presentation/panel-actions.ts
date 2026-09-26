import {
  setCanvasLayerPresentationActiveLayer,
  setCanvasLayerPresentationContourIntervalMeters,
  setCanvasLayerPresentationLocked,
  setCanvasLayerPresentationOpacity,
  setCanvasLayerPresentationVisibility,
} from './presentation'
import { saveGoogleMapsApiKey, setBasemapStyle } from '../map-layers/actions'

/**
 * Layer actions shared by both editions' Layers panels. Edition-neutral:
 * Desktop-only LiDAR wiring stays in the Desktop Layers panel.
 */
export const LAYER_PANEL_ACTIONS = {
  active: setCanvasLayerPresentationActiveLayer,
  visibility: setCanvasLayerPresentationVisibility,
  locked: setCanvasLayerPresentationLocked,
  opacity: setCanvasLayerPresentationOpacity,
  contourInterval: setCanvasLayerPresentationContourIntervalMeters,
  basemapStyle: setBasemapStyle,
  saveGoogleKey: saveGoogleMapsApiKey,
} as const
