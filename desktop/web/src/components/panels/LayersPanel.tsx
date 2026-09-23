import { useEffect } from 'preact/hooks'
import { LayerPanel } from '../canvas/LayerPanel'
import { LidarLayersSection } from './lidar/LidarLayersSection'
import { runAppCommand } from '../../commands/registry'
import {
  readCanvasLayerPresentation,
  setCanvasLayerPresentationActiveLayer,
  setCanvasLayerPresentationVisibility,
  setCanvasLayerPresentationLocked,
  setCanvasLayerPresentationOpacity,
  setCanvasLayerPresentationContourIntervalMeters,
} from '../../app/canvas-layer-presentation/presentation'
import { installLidarLibraryObserver } from '../../app/lidar/library-store'

export function LayersPanel({ onLocation = () => runAppCommand('nav.location') }: { onLocation?: () => void } = {}) {
  useEffect(() => installLidarLibraryObserver(), [])
  return (
    <LayerPanel
      rows={readCanvasLayerPresentation().rows}
      trailingSection={<LidarLayersSection />}
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
