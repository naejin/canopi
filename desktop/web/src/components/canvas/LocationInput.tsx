import { useSignal, useSignalEffect } from '@preact/signals'
import { useEffect, useMemo, useRef } from 'preact/hooks'
import { t } from '../../i18n'
import { locale } from '../../app/settings/state'
import { currentDesign } from '../../state/design'
import {
  clearDesignLocation,
  createLocationSearchController,
  saveLocationDraft,
  selectSearchResultLocation,
  type LocationSearchResult,
} from '../../app/location'
import styles from './LocationInput.module.css'

export function LocationInput() {
  void locale.value

  const search = useMemo(() => createLocationSearchController(), [])
  const design = currentDesign.value
  const location = design?.location ?? null

  const latInput = useSignal(location?.lat?.toString() ?? '')
  const lonInput = useSignal(location?.lon?.toString() ?? '')
  const altInput = useSignal(location?.altitude_m?.toString() ?? '')
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Resync input values when the design changes (e.g., open different file)
  useSignalEffect(() => {
    const loc = currentDesign.value?.location ?? null
    latInput.value = loc?.lat?.toString() ?? ''
    lonInput.value = loc?.lon?.toString() ?? ''
    altInput.value = loc?.altitude_m?.toString() ?? ''
  })

  // Click-outside-to-close + debounce cleanup
  useEffect(() => {
    function handlePointerUp(e: PointerEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
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
    latInput.value = result.lat.toString()
    lonInput.value = result.lon.toString()
    search.consumeResult()
    void selectSearchResultLocation(result, altInput.value)
  }

  function save() {
    void saveLocationDraft({
      lat: latInput.value,
      lon: lonInput.value,
      altitude: altInput.value,
    })
  }

  function clear() {
    void clearDesignLocation()
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
            value={search.query.value}
            onInput={(e) => { search.setQuery(e.currentTarget.value) }}
            placeholder={t('canvas.location.searchPlaceholder')}
          />
        </label>

        {search.isSearching.value && (
          <div className={styles.searchStatus}>
            {t('canvas.location.searching')}
          </div>
        )}

        {search.showDropdown.value && !search.isSearching.value && (
          <div className={styles.dropdown}>
            {search.errorKey.value ? (
              <div className={styles.dropdownError}>{t(search.errorKey.value)}</div>
            ) : search.results.value.length === 0 ? (
              <div className={styles.dropdownEmpty}>
                {t('canvas.location.noResults')}
              </div>
            ) : (
              search.results.value.map((result, i) => (
                <button
                  key={`${result.lat}-${result.lon}-${i}`}
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
