import { useSignalEffect } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { currentCanvasQuerySurface } from '../../canvas/session'
import {
  createCanvasMapSurfaceLifecycle,
  type CanvasMapSurfaceLifecycle,
} from '../../app/canvas-map-surface/lifecycle'
import { loadMapLibreTerrainSupport } from '../../maplibre/terrain-loader'
import {
  IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  type MapLibreCanvasSurfaceState,
} from '../../maplibre/canvas-surface-state'
import {
  contourIntervalMeters,
  hillshadeOpacity,
  hillshadeVisible,
  layerOpacity,
  layerVisibility,
} from '../../app/canvas-settings/signals'
import { northBearingDeg } from '../../canvas/scene-metadata-state'
import { sceneEntityRevision } from '../../canvas/runtime-mirror-state'
import { readPanelTargetOverlaySnapshot } from '../../app/panel-targets/presentation'
import { basemapStyle, theme } from '../../app/settings/state'
import { readSavedLocationPresentation } from '../../app/location'
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
    const runtime = currentCanvasQuerySurface.value
    const location = readSavedLocationPresentation().location
    const visibleLayers = layerVisibility.value
    const opacityByLayer = layerOpacity.value
    const bearing = northBearingDeg.value
    const preferredBasemapStyle = basemapStyle.value
    const activeTheme = theme.value
    const { hoveredTargets, selectedTargets } = readPanelTargetOverlaySnapshot()
    const contoursVisible = visibleLayers.contours ?? false
    const contoursOpacity = opacityByLayer.contours ?? 1
    const hillshadeOn = hillshadeVisible.value
    const hillshadeAlpha = hillshadeOpacity.value
    const contourInterval = contourIntervalMeters.value
    void runtime?.viewportRevision.value
    void sceneEntityRevision.value

    lifecycleRef.current?.update({
      runtime,
      location: location ? { lat: location.lat, lon: location.lon } : null,
      northBearingDeg: bearing,
      basemapStyle: preferredBasemapStyle,
      layerVisibility: { ...visibleLayers },
      layerOpacity: { ...opacityByLayer },
      terrain: {
        contourIntervalMeters: contourInterval,
        contoursVisible,
        contoursOpacity,
        hillshadeVisible: hillshadeOn,
        hillshadeOpacity: hillshadeAlpha,
        isDark: activeTheme === 'dark',
      },
      hoveredTargets: [...hoveredTargets],
      selectedTargets: [...selectedTargets],
      theme: activeTheme,
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
