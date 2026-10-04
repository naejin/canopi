// When the canvas shows an open Design rather than the start screen (CanvasPanel, WebCanvasWorkspace).

import { useRef } from 'preact/hooks'
import { currentCanvasDocumentSurface } from '../../canvas/session'
import type { MapLibreCanvasSurfaceState } from '../../maplibre/canvas-surface-state'

/**
 * A Design opened from the start screen shows (its chrome over its map) in the frame its first scene is drawn, so the chrome
 * never sits over an empty map; until then the start screen stays up and the chrome is laid out but transparent, so it
 * registers what it covers. A map that failed, or a canvas that could not start (reported as the map unavailable), draws
 * nothing: the Design shows at once, over the map notice. Once shown, an open Design stays shown until it is closed: opening
 * another over it, or a Retry rebuilding the map, never brings the start screen back.
 */
export function useOpenDesignShown(hasDesign: boolean, mapSurface: MapLibreCanvasSurfaceState): boolean {
  const shown = useRef(false)
  if (!hasDesign) shown.current = false
  else if (!shown.current) {
    shown.current = currentCanvasDocumentSurface.value?.presented.value === true || mapSurface.status === 'error'
  }
  return shown.current
}
