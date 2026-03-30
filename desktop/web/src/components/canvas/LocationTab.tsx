import { useSignal, useSignalEffect } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { geocodeAddress, type GeoResult } from '../../ipc/geocoding'
import { currentDesign } from '../../state/document'
import { clearDesignLocation, setDesignLocation } from '../../state/location-actions'
import styles from './LocationTab.module.css'

const DEFAULT_CENTER = { lat: 20, lon: 0 }
const STYLE_URL = 'https://demotiles.maplibre.org/style.json'

interface DraftLocation {
  lat: number
  lon: number
}

function locationsEqual(a: DraftLocation, b: DraftLocation | null): boolean {
  if (!b) return false
  return Math.abs(a.lat - b.lat) < 0.0001
    && Math.abs(a.lon - b.lon) < 0.0001
}

function formatCoordinates(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`
}

export function LocationTab() {
  void locale.value

  const initialLocation = currentDesign.value?.location
  const draft = useSignal<DraftLocation>({
    lat: initialLocation?.lat ?? DEFAULT_CENTER.lat,
    lon: initialLocation?.lon ?? DEFAULT_CENTER.lon,
  })
  const addressQuery = useSignal('')
  const searchResults = useSignal<GeoResult[]>([])
  const isSearching = useSignal(false)
  const showDropdown = useSignal(false)
  const searchError = useSignal('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  useSignalEffect(() => {
    const location = currentDesign.value?.location ?? null
    draft.value = {
      lat: location?.lat ?? DEFAULT_CENTER.lat,
      lon: location?.lon ?? DEFAULT_CENTER.lon,
    }
  })

  useSignalEffect(() => {
    const query = addressQuery.value.trim()

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    if (query.length < 3) {
      searchResults.value = []
      showDropdown.value = false
      isSearching.value = false
      searchError.value = ''
      return
    }

    isSearching.value = true
    searchError.value = ''

    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current
      try {
        const results = await geocodeAddress(query)
        if (requestId !== requestIdRef.current) return
        searchResults.value = results
        showDropdown.value = true
        isSearching.value = false
      } catch {
        if (requestId !== requestIdRef.current) return
        searchResults.value = []
        searchError.value = t('canvas.location.geocodeError')
        showDropdown.value = true
        isSearching.value = false
      }
    }, 300)
  })

  useEffect(() => {
    function handlePointerUp(event: PointerEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        showDropdown.value = false
      }
    }

    document.addEventListener('pointerup', handlePointerUp)
    return () => {
      document.removeEventListener('pointerup', handlePointerUp)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const committedLocation = currentDesign.value?.location ?? null
  const hasDraftChanges = !locationsEqual(draft.value, committedLocation)
  const draftCoordinates = formatCoordinates(draft.value.lat, draft.value.lon)
  const committedCoordinates = committedLocation
    ? formatCoordinates(committedLocation.lat, committedLocation.lon)
    : null

  function selectResult(result: GeoResult) {
    draft.value = {
      lat: result.lat,
      lon: result.lon,
    }
    addressQuery.value = ''
    searchResults.value = []
    showDropdown.value = false
  }

  function commitDraft() {
    setDesignLocation({
      lat: draft.value.lat,
      lon: draft.value.lon,
      altitude_m: null,
    })
  }

  const showChangeWarning = committedLocation !== null && hasDraftChanges

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerCopy}>
          <h3 className={styles.title}>{t('canvas.location.title')}</h3>
          <p className={styles.current}>{t('canvas.location.current')}: {draftCoordinates}</p>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.saveBtn} onClick={commitDraft} disabled={!hasDraftChanges}>
            {t('canvas.location.save')}
          </button>
          <button
            type="button"
            className={styles.clearBtn}
            onClick={() => clearDesignLocation()}
            disabled={committedLocation === null}
          >
            {t('canvas.location.clear')}
          </button>
        </div>
      </div>

      {showChangeWarning && (
        <div className={styles.warningCard}>
          {t('canvas.location.changeWarning')}
        </div>
      )}

      <div className={styles.searchSection} ref={dropdownRef}>
        <label className={styles.label}>
          {t('canvas.location.addressLabel')}
          <input
            type="text"
            className={styles.searchInput}
            value={addressQuery.value}
            onInput={(event) => { addressQuery.value = event.currentTarget.value }}
            placeholder={t('canvas.location.searchPlaceholder')}
          />
        </label>

        {isSearching.value && <div className={styles.searchStatus}>{t('canvas.location.searching')}</div>}

        {showDropdown.value && !isSearching.value && (
          <div className={styles.dropdown}>
            {searchError.value ? (
              <div className={styles.dropdownError}>{searchError.value}</div>
            ) : searchResults.value.length === 0 ? (
              <div className={styles.dropdownEmpty}>{t('canvas.location.noResults')}</div>
            ) : (
              searchResults.value.map((result, index) => (
                <button
                  key={`${result.lat}-${result.lon}-${index}`}
                  type="button"
                  className={styles.resultItem}
                  onClick={() => selectResult(result)}
                >
                  {result.display_name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className={styles.mapCard}>
        <div className={styles.mapHeader}>
          <div className={styles.mapSummary}>
            <span className={styles.summaryLabel}>{t('canvas.location.current')}</span>
            <strong className={styles.summaryValue}>{draftCoordinates}</strong>
          </div>
          {committedCoordinates ? (
            <div className={styles.savedPill}>
              {committedCoordinates}
            </div>
          ) : null}
        </div>

        <LocationMapSurface
          center={draft.value}
          onCenterChange={(center) => {
            draft.value = {
              ...draft.value,
              lat: center.lat,
              lon: center.lon,
            }
          }}
        />
      </div>

    </div>
  )
}

function LocationMapSurface({
  center,
  onCenterChange,
}: {
  center: DraftLocation
  onCenterChange: (center: { lat: number; lon: number }) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const onCenterChangeRef = useRef(onCenterChange)
  onCenterChangeRef.current = onCenterChange

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return

    const map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: [center.lon, center.lat],
      zoom: 3.2,
      attributionControl: false,
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right')
    map.on('moveend', () => {
      const nextCenter = map.getCenter()
      onCenterChangeRef.current({
        lat: nextCenter.lat,
        lon: nextCenter.lng,
      })
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    const map = mapRef.current
    if (!container || !map) return

    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const currentCenter = map.getCenter()
    if (
      Math.abs(currentCenter.lat - center.lat) < 0.0001
      && Math.abs(currentCenter.lng - center.lon) < 0.0001
    ) {
      return
    }

    map.easeTo({
      center: [center.lon, center.lat],
      duration: 300,
      essential: true,
    })
  }, [center.lat, center.lon])

  return (
    <div className={styles.mapShell}>
      <div ref={containerRef} className={styles.map} aria-label={t('canvas.location.title')} />
      <div className={styles.centerPin} aria-hidden="true" />
    </div>
  )
}
