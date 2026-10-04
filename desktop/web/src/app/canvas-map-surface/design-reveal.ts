// When the canvas shows an open Design rather than the start screen (CanvasPanel, WebCanvasWorkspace).

import { currentCanvasDocumentSurface } from '../../canvas/session'
import type { MapLibreCanvasSurfaceState } from '../../maplibre/canvas-surface-state'

/**
 * An open Design shows (its chrome over its map) in the frame its first scene is drawn, so the chrome never sits over an
 * empty map; until then the start screen stays up and the chrome is laid out but hidden, so it registers what it covers. A
 * map that failed draws nothing: the Design shows at once, over the map notice.
 */
export function isOpenDesignShown(hasDesign: boolean, mapSurface: MapLibreCanvasSurfaceState): boolean {
  if (!hasDesign) return false
  return currentCanvasDocumentSurface.value?.presented.value === true || mapSurface.status === 'error'
}
