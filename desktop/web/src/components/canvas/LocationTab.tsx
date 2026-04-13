import { useSignal, useSignalEffect } from '@preact/signals'
import { useEffect, useMemo, useRef } from 'preact/hooks'
import maplibregl from 'maplibre-gl'
import { t } from '../../i18n'
import {
  createDefaultMapLibreBasemapStyle,
  REMOTE_BASEMAP_TILE_URL_TEMPLATE,
} from '../../maplibre/config'
import { locale } from '../../app/settings/state'
import { currentDesign } from '../../state/design'
import {
  clearDesignLocation,
  createLocationSearchController,
  setDesignLocation,
  type LocationSearchResult,
} from '../../app/location'
import { navigateTo } from '../../app/shell/state'
import { buildLocationCommit, computeSavedPinState } from './location-tab-logic'
import styles from './LocationTab.module.css'

const DEFAULT_CENTER: [number, number] = [0, 20] // [lon, lat]

export function LocationTab() {
  void locale.value

  const search = useMemo(() => createLocationSearchController(), [])
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  const pendingResult = useSignal<{ lat: number; lon: number } | null>(null)

  // Saved pin state
  const pinState = useSignal<{
    visible: boolean
    x: number
    y: number
    clamped: boolean
    angle: number
  }>({ visible: false, x: 0, y: 0, clamped: false, angle: 0 })
  const committedLocation = currentDesign.value?.location ?? null

  // Initialize map
  useEffect(() => {
    const container = mapContainerRef.current
    if (!container || mapRef.current) return
    const savedLoc = currentDesign.value?.location
    const center: [number, number] = savedLoc
      ? [savedLoc.lon, savedLoc.lat]
      : DEFAULT_CENTER

    const map = new maplibregl.Map({
      container,
      style: createDefaultMapLibreBasemapStyle(REMOTE_BASEMAP_TILE_URL_TEMPLATE),
      center,
      zoom: savedLoc ? 10 : 3.2,
      attributionControl: { compact: true },
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right')
    const onMove = () => updatePinPosition(map)
    const onDragStart = () => { pendingResult.value = null }
    map.on('move', onMove)
    map.on('moveend', onMove)
    map.on('dragstart', onDragStart)

    mapRef.current = map
    updatePinPosition(map)

    return () => {
      map.off('move', onMove)
      map.off('moveend', onMove)
      map.off('dragstart', onDragStart)
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Resize observer — reads mapRef inside callback to avoid stale capture
  useEffect(() => {
    const container = mapContainerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      const map = mapRef.current
      if (!map) return
      map.resize()
      updatePinPosition(map)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Update pin when saved location changes
  useSignalEffect(() => {
    void currentDesign.value?.location
    const map = mapRef.current
    if (map) updatePinPosition(map)
  })

  // Click outside to close dropdown
  useEffect(() => {
    function handlePointerUp(event: PointerEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        search.closeDropdown()
      }
    }

    document.addEventListener('pointerup', handlePointerUp)
    return () => {
      document.removeEventListener('pointerup', handlePointerUp)
      search.dispose()
    }
  }, [search])

  function selectResult(result: LocationSearchResult) {
    search.consumeResult()
    pendingResult.value = { lat: result.lat, lon: result.lon }

    const map = mapRef.current
    if (map) {
      map.easeTo({
        center: [result.lon, result.lat],
        zoom: 14,
        duration: 600,
        essential: true,
      })
    }
  }

  function handleSet() {
    const pending = pendingResult.value
    if (pending) {
      setDesignLocation(buildLocationCommit(pending, committedLocation))
      pendingResult.value = null
    } else {
      const map = mapRef.current
      if (!map) return
      const center = map.getCenter()
      setDesignLocation(buildLocationCommit({ lat: center.lat, lon: center.lng }, committedLocation))
    }
  }

  function handleClear() {
    clearDesignLocation()
    pendingResult.value = null
  }

  function updatePinPosition(map: maplibregl.Map) {
    const loc = currentDesign.value?.location ?? null
    const container = map.getContainer()
    const next = computeSavedPinState(
      loc,
      { width: container.clientWidth, height: container.clientHeight },
      loc ? map.project([loc.lon, loc.lat]) : { x: 0, y: 0 },
    )

    // Only write if position actually changed — avoids 60fps signal churn during pan
    const prev = pinState.peek()
    if (
      prev.visible !== next.visible ||
      prev.clamped !== next.clamped ||
      Math.abs(prev.x - next.x) > 0.5 ||
      Math.abs(prev.y - next.y) > 0.5 ||
      Math.abs(prev.angle - next.angle) > 0.001
    ) {
      pinState.value = next
    }
  }

  const pin = pinState.value

  return (
    <div className={styles.container}>
      <div ref={mapContainerRef} className={styles.map} />

      {/* Floating search bar */}
      <div className={styles.searchOverlay} ref={searchRef}>
        <div className={styles.searchRow}>
          <input
            type="text"
            className={styles.searchInput}
            value={search.query.value}
            onInput={(e) => { search.setQuery(e.currentTarget.value) }}
            placeholder={t('canvas.location.searchPlaceholder')}
          />
          <button type="button" className={styles.setBtn} onClick={handleSet}>
            {t('canvas.location.save')}
          </button>
          {committedLocation && (
            <button type="button" className={styles.clearBtn} onClick={handleClear}>
              {t('canvas.location.clear')}
            </button>
          )}
        </div>

        {search.isSearching.value && (
          <div className={styles.searchStatus}>{t('canvas.location.searching')}</div>
        )}

        {search.showDropdown.value && !search.isSearching.value && (
          <div className={styles.dropdown}>
            {search.errorKey.value ? (
              <div className={styles.dropdownError}>{t(search.errorKey.value)}</div>
            ) : search.results.value.length === 0 ? (
              <div className={styles.dropdownEmpty}>{t('canvas.location.noResults')}</div>
            ) : (
              search.results.value.map((result, index) => (
                <button
                  key={`${result.lat}-${result.lon}-${index}`}
                  type="button"
                  className={styles.resultItem}
                  onClick={() => selectResult(result)}
                >
                  {result.displayName}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Back to canvas */}
      <button
        type="button"
        className={styles.collapseBtn}
        onClick={() => navigateTo('canvas')}
        aria-label={t('commands.canvas')}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M10.5 3.5L5.5 8L10.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Center crosshair — always visible, shows where "Set" will place the pin */}
      <div className={styles.centerCrosshair} aria-hidden="true" />

      {/* Saved location pin — shows committed design location */}
      {pin.visible && !pin.clamped && (
        <div
          className={styles.savedPin}
          style={{ left: `${pin.x}px`, top: `${pin.y}px` }}
        />
      )}
      {pin.visible && pin.clamped && (
        <div
          className={styles.savedPinClamped}
          style={{
            left: `${pin.x}px`,
            top: `${pin.y}px`,
            transform: `translate(-50%, -50%) rotate(${pin.angle}rad)`,
          }}
        />
      )}
    </div>
  )
}
