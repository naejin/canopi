import { useSignalEffect } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import {
  createCanvasMapSurfaceLifecycle,
  type CanvasMapSurfaceLifecycle,
} from '../../app/canvas-map-surface/lifecycle'
import { readCanvasMapSurfaceSnapshot } from '../../app/canvas-map-surface/snapshot'
import { loadMapLibreTerrainSupport } from '../../maplibre/terrain-loader'
import {
  IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  type MapLibreCanvasSurfaceState,
} from '../../maplibre/canvas-surface-state'
import { loadMapLibre } from './maplibre-loader'

interface UseMapLibreCanvasSurfaceControllerOptions {
  readonly onStateChange?: (state: MapLibreCanvasSurfaceState) => void
}

export function useMapLibreCanvasSurfaceController({
  onStateChange,
}: UseMapLibreCanvasSurfaceControllerOptions): { surfaceRef: { current: HTMLDivElement | null } } {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const lifecycleRef = useRef<CanvasMapSurfaceLifecycle | null>(null)
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange

  if (!lifecycleRef.current) {
    lifecycleRef.current = createCanvasMapSurfaceLifecycle({
      loadMapLibre,
      loadTerrainSupport: loadMapLibreTerrainSupport,
      onStateChange: (state) => {
        onStateChangeRef.current?.(state)
      },
    })
  }

  useSignalEffect(() => {
    lifecycleRef.current?.update(readCanvasMapSurfaceSnapshot())
  })

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) {
      onStateChangeRef.current?.(IDLE_MAPLIBRE_CANVAS_SURFACE_STATE)
      return
    }
    lifecycleRef.current?.attach(surface)
    return () => {
      lifecycleRef.current?.destroy()
    }
  }, [])

  return { surfaceRef }
}
