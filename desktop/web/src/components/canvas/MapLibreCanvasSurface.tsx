import { useSignalEffect } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { currentCanvasSession } from '../../canvas/session'
import { computeMapLibreCamera } from '../../canvas/maplibre-camera'
import { layerOpacity, layerVisibility, northBearingDeg } from '../../state/canvas'
import { currentDesign } from '../../state/document'
import { loadMapLibre } from './maplibre-loader'
import styles from './MapLibreCanvasSurface.module.css'

const STYLE_URL = 'https://demotiles.maplibre.org/style.json'

type MapInstance = import('maplibre-gl').Map

interface MapCameraSnapshot {
  readonly center: readonly [number, number]
  readonly zoom: number
  readonly bearing: number
}

export function MapLibreCanvasSurface({
  onActiveChange,
}: {
  onActiveChange?: (active: boolean) => void
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapInstance | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const loadRevisionRef = useRef(0)
  const cameraRef = useRef<MapCameraSnapshot | null>(null)
  const activeRef = useRef(false)

  const setActive = (active: boolean): void => {
    if (activeRef.current === active) return
    activeRef.current = active
    onActiveChange?.(active)
  }

  const destroyMap = (): void => {
    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = null
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }
    cameraRef.current = null
    setActive(false)
  }

  const applyCamera = (map: MapInstance, bearing: number | null): void => {
    const runtime = currentCanvasSession.peek()
    const location = currentDesign.peek()?.location ?? null
    if (!runtime || !location) return

    const next = computeMapLibreCamera(
      runtime.getViewport(),
      runtime.getViewportScreenSize(),
      location,
      bearing,
    )
    if (!next) return
    const previous = cameraRef.current
    if (
      previous
      && Math.abs(previous.center[0] - next.center[0]) < 0.000001
      && Math.abs(previous.center[1] - next.center[1]) < 0.000001
      && Math.abs(previous.zoom - next.zoom) < 0.000001
      && Math.abs(previous.bearing - next.bearing) < 0.000001
    ) {
      return
    }

    map.jumpTo({
      center: [next.center[0], next.center[1]],
      zoom: next.zoom,
      bearing: next.bearing,
    })
    cameraRef.current = next
  }

  const ensureMap = async (): Promise<void> => {
    const runtime = currentCanvasSession.peek()
    const location = currentDesign.peek()?.location ?? null
    const visible = layerVisibility.peek().base ?? true
    const surface = surfaceRef.current
    if (!runtime || !location || !visible || !surface) {
      destroyMap()
      return
    }

    if (mapRef.current) {
      mapRef.current.resize()
      applyCamera(mapRef.current, northBearingDeg.peek())
      setActive(true)
      return
    }

    const loadRevision = ++loadRevisionRef.current
    const module = await loadMapLibre()
    if (loadRevision !== loadRevisionRef.current) return

    const map = new module.Map({
      container: surface,
      style: STYLE_URL,
      attributionControl: false,
      interactive: false,
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: false,
    })
    mapRef.current = map
    applyCamera(map, northBearingDeg.peek())
    map.resize()

    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = new ResizeObserver(() => {
      if (!mapRef.current) return
      mapRef.current.resize()
      applyCamera(mapRef.current, northBearingDeg.peek())
    })
    resizeObserverRef.current.observe(surface)
    setActive(true)
  }

  useSignalEffect(() => {
    const opacity = layerOpacity.value.base ?? 1
    if (surfaceRef.current) surfaceRef.current.style.opacity = String(opacity)
  })

  useSignalEffect(() => {
    const runtime = currentCanvasSession.value
    const location = currentDesign.value?.location ?? null
    const visible = layerVisibility.value.base ?? true
    const bearing = northBearingDeg.value
    void runtime?.viewportRevision.value

    if (!runtime || !location || !visible) {
      destroyMap()
      return
    }

    void ensureMap().then(() => {
      if (mapRef.current) applyCamera(mapRef.current, bearing)
    })
  })

  useEffect(() => () => {
    destroyMap()
  }, [])

  return <div ref={surfaceRef} className={styles.surface} aria-hidden="true" />
}
