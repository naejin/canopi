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
import { hoveredPanelTargets, selectedPanelTargets } from '../../app/panel-targets/state'
import { basemapStyle, theme } from '../../app/settings/state'
import { currentDesign } from '../../state/design'
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
    const design = currentDesign.value
    const location = design?.location ?? null
    const visibleLayers = layerVisibility.value
    const opacityByLayer = layerOpacity.value
    const bearing = northBearingDeg.value
    const preferredBasemapStyle = basemapStyle.value
    const activeTheme = theme.value
    const hoverTargets = hoveredPanelTargets.value
    const selectionTargets = selectedPanelTargets.value
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
      hoveredTargets: [...hoverTargets],
      selectedTargets: [...selectionTargets],
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
