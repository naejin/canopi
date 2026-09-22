import { t } from '../../i18n'
import {
  useLocationWorkbench,
  type LocationSearchResult,
} from '../../app/location'
import { useLocationMapEditingHost } from '../../app/location/map-editing'
import { navigateTo } from '../../app/shell/state'
import styles from './LocationTab.module.css'
import { BasemapSettings } from './BasemapSettings'

export function LocationTab() {
  const workbench = useLocationWorkbench()
  const search = workbench.search
  const mapHost = useLocationMapEditingHost(workbench)

  function selectResult(result: LocationSearchResult) {
    mapHost.previewSearchResult(result)
  }

  const pin = mapHost.pin
  const mapUnavailable = mapHost.mapUnavailable
  const placementStatus = workbench.committedPlacementStatus
  const statusTitle = mapHost.hasPendingPlacement
    ? t('canvas.location.selectedTitle')
    : placementStatus === 'confirmed'
      ? t('canvas.location.confirmedTitle')
      : t('canvas.location.provisionalTitle')

  return (
    <div className={styles.container}>
      <div ref={mapHost.mapContainerRef} className={styles.map} />
      {mapUnavailable && (
        <div className={styles.mapUnavailable} role="alert">
          {t('canvas.location.mapUnavailable')}
        </div>
      )}

      {/* Floating search bar */}
      <div className={styles.searchOverlay} ref={search.setDropdownElement}>
        <div className={styles.searchRow}>
          <input
            type="text"
            className={styles.searchInput}
            value={search.query.value}
            onInput={(e) => { search.setQuery(e.currentTarget.value) }}
            placeholder={t('canvas.location.searchPlaceholder')}
          />
          <button
            type="button"
            className={styles.setBtn}
            onClick={mapHost.confirmLocation}
            disabled={!mapHost.canConfirmLocation}
          >
            {placementStatus === 'confirmed'
              ? t('canvas.location.move')
              : t('canvas.location.confirm')}
          </button>
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

      <section className={styles.placementStatus} aria-live="polite">
        <strong>{statusTitle}</strong>
        <span>
          {mapHost.hasPendingPlacement
            ? workbench.saved.anchorSummary
            : placementStatus === 'confirmed'
              ? workbench.saved.summary
              : t('canvas.location.provisionalBody')}
        </span>
      </section>

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

      {/* Center crosshair — always visible, shows where the location action will place the Design */}
      {!mapUnavailable && <div className={styles.centerCrosshair} aria-hidden="true" />}

      {/* Saved location pin — shows committed design location */}
      {!mapUnavailable && pin.visible && !pin.clamped && (
        <div
          className={styles.savedPin}
          style={{ left: `${pin.x}px`, top: `${pin.y}px` }}
        />
      )}
      {!mapUnavailable && pin.visible && pin.clamped && (
        <div
          className={styles.savedPinClamped}
          style={{
            left: `${pin.x}px`,
            top: `${pin.y}px`,
            transform: `translate(-50%, -50%) rotate(${pin.angle}rad)`,
          }}
        />
      )}

      {/*
        Provider settings stay reachable when the map cannot load, because
        choosing a different provider is one of the ways out of a map failure.
      */}
      <BasemapSettings />
    </div>
  )
}
