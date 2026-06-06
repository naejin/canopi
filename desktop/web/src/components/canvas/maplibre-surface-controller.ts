import { useSignalEffect } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import {
  createCanvasMapSurfaceLifecycle,
  type CanvasMapSurfaceLifecycle,
} from '../../app/canvas-map-surface/lifecycle'
import { readCanvasMapSurfaceCoreSnapshot } from '../../app/canvas-map-surface/snapshot'
import { loadMapLibreTerrainSupport } from '../../maplibre/terrain-loader'
import {
  IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  type MapLibreCanvasSurfaceState,
} from '../../maplibre/canvas-surface-state'
import {
  contourIntervalMeters,
  hillshadeOpacity,
  hillshadeVisible,
} from '../../app/canvas-settings/signals'
import { readPanelTargetOverlaySnapshot } from '../../app/panel-targets/presentation'
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
    const coreSnapshot = readCanvasMapSurfaceCoreSnapshot()
    const { hoveredTargets, selectedTargets } = readPanelTargetOverlaySnapshot()
    const contoursVisible = coreSnapshot.layerVisibility.contours ?? false
    const contoursOpacity = coreSnapshot.layerOpacity.contours ?? 1
    const hillshadeOn = hillshadeVisible.value
    const hillshadeAlpha = hillshadeOpacity.value
    const contourInterval = contourIntervalMeters.value

    lifecycleRef.current?.update({
      ...coreSnapshot,
      terrain: {
        contourIntervalMeters: contourInterval,
        contoursVisible,
        contoursOpacity,
        hillshadeVisible: hillshadeOn,
        hillshadeOpacity: hillshadeAlpha,
        isDark: coreSnapshot.theme === 'dark',
      },
      hoveredTargets: [...hoveredTargets],
      selectedTargets: [...selectedTargets],
    })
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
