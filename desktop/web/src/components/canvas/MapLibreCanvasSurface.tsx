import type { MapLibreCanvasSurfaceState } from '../../maplibre/canvas-surface-state'
import { useMapLibreCanvasSurfaceController } from './maplibre-surface-controller'
import styles from './MapLibreCanvasSurface.module.css'

export type { MapLibreCanvasSurfaceState } from '../../maplibre/canvas-surface-state'

export function MapLibreCanvasSurface({
  onStateChange,
}: {
  onStateChange?: (state: MapLibreCanvasSurfaceState) => void
}) {
  const { surfaceRef } = useMapLibreCanvasSurfaceController({ onStateChange })

  return <div ref={surfaceRef} className={styles.surface} aria-hidden="true" />
}
