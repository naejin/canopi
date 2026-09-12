import { LayerPanel } from '../canvas/LayerPanel'
import { runAppCommand } from '../../commands/registry'
import {
  readCanvasLayerPresentation,
  setCanvasLayerPresentationActiveLayer,
  setCanvasLayerPresentationVisibility,
  setCanvasLayerPresentationLocked,
  setCanvasLayerPresentationOpacity,
  setCanvasLayerPresentationContourIntervalMeters,
} from '../../app/canvas-layer-presentation/presentation'

export function LayersPanel({ onLocation = () => runAppCommand('nav.location') }: { onLocation?: () => void } = {}) {
  return (
    <LayerPanel
      rows={readCanvasLayerPresentation().rows}
      actions={{
        active: setCanvasLayerPresentationActiveLayer,
        visibility: setCanvasLayerPresentationVisibility,
        locked: setCanvasLayerPresentationLocked,
        opacity: setCanvasLayerPresentationOpacity,
        contourInterval: setCanvasLayerPresentationContourIntervalMeters,
        location: onLocation,
      }}
    />
  )
}
