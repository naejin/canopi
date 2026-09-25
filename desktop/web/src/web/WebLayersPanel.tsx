import { LayerPanel } from '../components/canvas/LayerPanel'
import { LAYER_PANEL_ACTIONS } from '../components/panels/LayersPanel'
import { readCanvasLayerPresentation } from '../app/canvas-layer-presentation/presentation'

/** Web has no local terrain or LiDAR, so its Site references are Basemap and Satellite. */
const WEB_REFERENCE_ROWS: ReadonlySet<string> = new Set(['basemap', 'satellite'])

export function WebLayersPanel() {
  const rows = readCanvasLayerPresentation().rows.filter((row) =>
    row.authority === 'scene' || WEB_REFERENCE_ROWS.has(row.id))
  return <LayerPanel rows={rows} actions={LAYER_PANEL_ACTIONS} />
}
