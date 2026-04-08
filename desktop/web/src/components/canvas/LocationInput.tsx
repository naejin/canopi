import { useSignal, useSignalEffect } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { currentDesign } from '../../state/document'
import { geocodeAddress } from '../../ipc/geocoding'
import type { GeoResult } from '../../ipc/geocoding'
import { clearDesignLocation, setDesignLocation } from '../../state/location-actions'
import styles from './LocationInput.module.css'

export function LocationInput() {
  void locale.value

  const design = currentDesign.value
  const location = design?.location ?? null

  const latInput = useSignal(location?.lat?.toString() ?? '')
  const lonInput = useSignal(location?.lon?.toString() ?? '')
  const altInput = useSignal(location?.altitude_m?.toString() ?? '')

  // Address search state
  const addressQuery = useSignal('')
  const searchResults = useSignal<GeoResult[]>([])
  const isSearching = useSignal(false)
  const showDropdown = useSignal(false)
  const searchError = useSignal('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  // Resync input values when the design changes (e.g., open different file)
  useSignalEffect(() => {
    const loc = currentDesign.value?.location ?? null
    latInput.value = loc?.lat?.toString() ?? ''
    lonInput.value = loc?.lon?.toString() ?? ''
    altInput.value = loc?.altitude_m?.toString() ?? ''
  })

  // Debounced geocode search
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
      const myId = ++requestIdRef.current
      try {
        const results = await geocodeAddress(query)
        if (requestIdRef.current !== myId) return // superseded by newer request
        searchResults.value = results
        showDropdown.value = true
        isSearching.value = false
      } catch (e) {
        if (requestIdRef.current !== myId) return
        searchError.value = t('canvas.location.geocodeError')
        searchResults.value = []
        showDropdown.value = true
        isSearching.value = false
      }
    }, 300)
  })

  // Click-outside-to-close + debounce cleanup
  useEffect(() => {
    function handlePointerUp(e: PointerEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        showDropdown.value = false
      }
    }
    document.addEventListener('pointerup', handlePointerUp)
    return () => {
      document.removeEventListener('pointerup', handlePointerUp)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  function selectResult(result: GeoResult) {
    latInput.value = result.lat.toString()
    lonInput.value = result.lon.toString()
    addressQuery.value = ''
    searchResults.value = []
    showDropdown.value = false

    // Auto-save the selected location — read current design at call time, not render time
    if (!currentDesign.peek()) return
    const alt = parseFloat(altInput.value)
    setDesignLocation({ lat: result.lat, lon: result.lon, altitude_m: isNaN(alt) ? null : alt })
  }

  function save() {
    if (!currentDesign.peek()) return
    const lat = parseFloat(latInput.value)
    const lon = parseFloat(lonInput.value)
    if (isNaN(lat) || isNaN(lon)) return
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return

    const alt = parseFloat(altInput.value)

    setDesignLocation({ lat, lon, altitude_m: isNaN(alt) ? null : alt })
  }

  function clear() {
    if (!currentDesign.peek()) return
    clearDesignLocation()
    latInput.value = ''
    lonInput.value = ''
    altInput.value = ''
  }

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>{t('canvas.location.title')}</h3>

      {/* Address search */}
      <div className={styles.searchSection} ref={dropdownRef}>
        <label className={styles.label}>
          {t('canvas.location.addressLabel')}
          <input
            type="text"
            className={styles.searchInput}
            value={addressQuery.value}
            onInput={(e) => { addressQuery.value = e.currentTarget.value }}
            placeholder={t('canvas.location.searchPlaceholder')}
          />
        </label>

        {isSearching.value && (
          <div className={styles.searchStatus}>
            {t('canvas.location.searching')}
          </div>
        )}

        {showDropdown.value && !isSearching.value && (
          <div className={styles.dropdown}>
            {searchError.value ? (
              <div className={styles.dropdownError}>{searchError.value}</div>
            ) : searchResults.value.length === 0 ? (
              <div className={styles.dropdownEmpty}>
                {t('canvas.location.noResults')}
              </div>
            ) : (
              searchResults.value.map((result, i) => (
                <button
                  key={`${result.lat}-${result.lon}-${i}`}
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

      <div className={styles.fields}>
        <label className={styles.label}>
          {t('canvas.location.latitude')}
          <input
            type="number"
            className={styles.input}
            value={latInput.value}
            onInput={(e) => { latInput.value = e.currentTarget.value }}
            placeholder={t('canvas.location.latRange')}
            step="0.0001"
            min="-90"
            max="90"
          />
        </label>

        <label className={styles.label}>
          {t('canvas.location.longitude')}
          <input
            type="number"
            className={styles.input}
            value={lonInput.value}
            onInput={(e) => { lonInput.value = e.currentTarget.value }}
            placeholder={t('canvas.location.lonRange')}
            step="0.0001"
            min="-180"
            max="180"
          />
        </label>

        <label className={styles.label}>
          {t('canvas.location.altitude')}
          <input
            type="number"
            className={styles.input}
            value={altInput.value}
            onInput={(e) => { altInput.value = e.currentTarget.value }}
            placeholder={t('canvas.location.optional')}
            step="1"
          />
        </label>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.saveBtn} onClick={save}>
          {t('canvas.location.save')}
        </button>
        {location && (
          <button type="button" className={styles.clearBtn} onClick={clear}>
            {t('canvas.location.clear')}
          </button>
        )}
      </div>

      {location && (
        <p className={styles.current}>
          {t('canvas.location.current')}: {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
          {location.altitude_m != null && ` (${location.altitude_m} m)`}
        </p>
      )}
    </div>
  )
}
