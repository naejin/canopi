import { locale } from '../app/settings/state'
import { useLocationCoordinateWorkbench } from '../app/location/coordinate-workbench'
import { useLocationMapEditingHost } from '../app/location/map-editing'
import { navigateTo } from '../app/shell/state'
import { t } from '../i18n'
import styles from './WebLocationWorkspace.module.css'

export function WebLocationWorkspace() {
  void locale.value
  const workbench = useLocationCoordinateWorkbench({ altitudeMode: 'omit' })
  const mapHost = useLocationMapEditingHost(workbench, { basemapStyle: 'street' })
  const pin = mapHost.pin

  function saveLocation(): void {
    workbench.saveDraft()
  }

  function clearLocation(): void {
    mapHost.clearLocation()
  }

  return (
    <div className={styles.workspace} data-testid="web-location-workspace">
      <div ref={mapHost.mapContainerRef} className={styles.map} />
      {mapHost.mapUnavailable && (
        <div className={styles.mapUnavailable} role="alert">
          {t('canvas.location.mapUnavailable')}
        </div>
      )}

      {!mapHost.mapUnavailable && <div className={styles.centerCrosshair} aria-hidden="true" />}
      {!mapHost.mapUnavailable && pin.visible && !pin.clamped && (
        <div
          className={styles.savedPin}
          style={{ left: `${pin.x}px`, top: `${pin.y}px` }}
          aria-hidden="true"
        />
      )}
      {!mapHost.mapUnavailable && pin.visible && pin.clamped && (
        <div
          className={styles.savedPinClamped}
          style={{
            left: `${pin.x}px`,
            top: `${pin.y}px`,
            transform: `translate(-50%, -50%) rotate(${pin.angle}rad)`,
          }}
          aria-hidden="true"
        />
      )}

      <section className={styles.searchOverlay} aria-label={t('canvas.location.title')}>
        <div className={styles.searchRow}>
          <input
            type="number"
            className={styles.coordinateInput}
            value={workbench.latDraft}
            onInput={(event) => { workbench.setLatDraft(event.currentTarget.value) }}
            aria-label={t('canvas.location.latitude')}
            placeholder={t('canvas.location.latRange')}
            step="0.0001"
            min="-90"
            max="90"
            data-testid="web-location-latitude"
          />
          <input
            type="number"
            className={styles.coordinateInput}
            value={workbench.lonDraft}
            onInput={(event) => { workbench.setLonDraft(event.currentTarget.value) }}
            aria-label={t('canvas.location.longitude')}
            placeholder={t('canvas.location.lonRange')}
            step="0.0001"
            min="-180"
            max="180"
            data-testid="web-location-longitude"
          />
          <button
            type="button"
            className={styles.setBtn}
            onClick={saveLocation}
            data-testid="web-location-save"
          >
            {t('canvas.location.save')}
          </button>
          {mapHost.committedLocation && (
            <button
              type="button"
              className={styles.clearBtn}
              onClick={clearLocation}
              data-testid="web-location-clear"
            >
              {t('canvas.location.clear')}
            </button>
          )}
        </div>
      </section>

      <button
        type="button"
        className={styles.collapseBtn}
        onClick={() => navigateTo('canvas')}
        aria-label={t('commands.canvas')}
        data-testid="web-location-collapse"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M10.5 3.5L5.5 8L10.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}
