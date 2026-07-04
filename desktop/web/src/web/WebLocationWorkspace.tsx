import { locale } from '../app/settings/state'
import { useLocationCoordinateWorkbench } from '../app/location/coordinate-workbench'
import { useLocationMapEditingHost } from '../app/location/map-editing'
import { t } from '../i18n'
import styles from './WebLocationWorkspace.module.css'

export function WebLocationWorkspace() {
  void locale.value
  const workbench = useLocationCoordinateWorkbench()
  const mapHost = useLocationMapEditingHost(workbench, { basemapStyle: 'street' })
  const pin = mapHost.pin

  function saveManualLocation(): void {
    workbench.saveDraft()
  }

  function saveMapLocation(): void {
    mapHost.commitMapLocation()
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

      <section className={styles.controls} aria-label={t('canvas.location.title')}>
        <h2 className={styles.title}>{t('canvas.location.title')}</h2>
        <div className={styles.fields}>
          <label className={styles.label}>
            <span>{t('canvas.location.latitude')}</span>
            <input
              type="number"
              className={styles.input}
              value={workbench.latDraft}
              onInput={(event) => { workbench.setLatDraft(event.currentTarget.value) }}
              placeholder={t('canvas.location.latRange')}
              step="0.0001"
              min="-90"
              max="90"
              data-testid="web-location-latitude"
            />
          </label>
          <label className={styles.label}>
            <span>{t('canvas.location.longitude')}</span>
            <input
              type="number"
              className={styles.input}
              value={workbench.lonDraft}
              onInput={(event) => { workbench.setLonDraft(event.currentTarget.value) }}
              placeholder={t('canvas.location.lonRange')}
              step="0.0001"
              min="-180"
              max="180"
              data-testid="web-location-longitude"
            />
          </label>
          <label className={styles.label}>
            <span>{t('canvas.location.altitude')}</span>
            <input
              type="number"
              className={styles.input}
              value={workbench.altitudeDraft}
              onInput={(event) => { workbench.setAltitudeDraft(event.currentTarget.value) }}
              placeholder={t('canvas.location.optional')}
              step="1"
              data-testid="web-location-altitude"
            />
          </label>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={saveManualLocation}
            data-testid="web-location-save-manual"
          >
            {t('canvas.location.save')}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={saveMapLocation}
            data-testid="web-location-save-map"
          >
            {t('canvas.location.setMapPin')}
          </button>
          {workbench.saved.location && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={clearLocation}
              data-testid="web-location-clear"
            >
              {t('canvas.location.clear')}
            </button>
          )}
        </div>

        {workbench.saved.location && (
          <p className={styles.current}>
            {t('canvas.location.current')}: {workbench.saved.summary}
          </p>
        )}
      </section>
    </div>
  )
}
