import { useState } from 'preact/hooks'
import { t } from '../i18n'
import { useLocationCoordinateWorkbench } from '../app/location/coordinate-workbench'
import { useLocationMapEditingHost } from '../app/location/map-editing'
import { navigateTo } from '../app/shell/state'
import { BasemapSettings } from '../components/canvas/BasemapSettings'
import styles from './web-location-panel.module.css'

/** The Mercator-bounded latitude domain the shared validation also applies. */
const MAX_MERCATOR_LATITUDE = 85.051_128_78

/**
 * The Web Edition's Design Location surface.
 *
 * It composes the shared coordinate workbench directly — the same validation,
 * preview, confirm, cancel and undo semantics Desktop runs — and deliberately
 * has **no address search**: that capability stays Desktop-only under
 * [ADR 0028](../../../docs/adr/0028-web-location-and-shared-basemaps.md), and
 * this module must not reach the `app/location` barrel, which pulls geocoding in
 * through its search controller.
 *
 * Coordinates and the map centre produce the same candidate frame, so the
 * surface is complete for what it offers rather than a stub of the Desktop
 * shape. Nothing commits on camera movement: only Confirm does, and Escape,
 * Cancel or unmount abort the pending edit.
 */
export function WebLocationPanel() {
  const workbench = useLocationCoordinateWorkbench()
  const mapHost = useLocationMapEditingHost(workbench)
  const [draft, setDraft] = useState({ lat: '', lon: '' })
  const [invalid, setInvalid] = useState(false)

  // The pending frame when one exists, otherwise the saved anchor. Reading the
  // frame rather than a separate mirror keeps the display and the transaction
  // from disagreeing.
  const pending = workbench.pendingPlacement
  const shown = pending
    ? {
        lat: pending.anchor_latitude_deg,
        lon: pending.anchor_longitude_deg,
      }
    : workbench.saved.location

  const placementStatus = workbench.committedPlacementStatus
  const statusTitle = mapHost.hasPendingPlacement
    ? t('canvas.location.selectedTitle')
    : placementStatus === 'confirmed'
      ? t('canvas.location.confirmedTitle')
      : t('canvas.location.provisionalTitle')

  function submitDraft(): void {
    const lat = Number(draft.lat.trim())
    const lon = Number(draft.lon.trim())
    // Empty, non-finite and out-of-domain values are refused before any
    // preview, matching the rule the shared workbench applies.
    const valid =
      draft.lat.trim() !== '' &&
      draft.lon.trim() !== '' &&
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= MAX_MERCATOR_LATITUDE &&
      Math.abs(lon) <= 180
    setInvalid(!valid)
    if (!valid) return
    workbench.previewMapLocation({ lat, lon })
  }

  return (
    <div className={styles.container}>
      <div ref={mapHost.mapContainerRef} className={styles.map} />
      {mapHost.mapUnavailable ? (
        <div className={styles.mapUnavailable} role="alert">
          {t('canvas.location.mapUnavailable')}
        </div>
      ) : null}

      <form
        className={styles.coordinateForm}
        onSubmit={(event) => {
          event.preventDefault()
          submitDraft()
        }}
        aria-label={t('canvas.location.coordinates')}
      >
        <label className={styles.field}>
          <span>{t('canvas.location.latitude')}</span>
          <input
            type="text"
            inputMode="decimal"
            value={draft.lat}
            placeholder={String(shown?.lat ?? '')}
            onInput={(event) => {
              setInvalid(false)
              setDraft((current) => ({ ...current, lat: event.currentTarget.value }))
            }}
          />
        </label>
        <label className={styles.field}>
          <span>{t('canvas.location.longitude')}</span>
          <input
            type="text"
            inputMode="decimal"
            value={draft.lon}
            placeholder={String(shown?.lon ?? '')}
            onInput={(event) => {
              setInvalid(false)
              setDraft((current) => ({ ...current, lon: event.currentTarget.value }))
            }}
          />
        </label>
        <div className={styles.actions}>
          {/* Preview only. Coordinate entry never commits by itself. */}
          <button type="submit" className={styles.secondary}>
            {t('canvas.location.preview')}
          </button>
        </div>
        {invalid ? (
          <p className={styles.error} role="alert">
            {t('canvas.location.invalidCoordinates')}
          </p>
        ) : null}
      </form>

      <section className={styles.placementStatus} aria-live="polite">
        <strong>{statusTitle}</strong>
        <span>
          {mapHost.hasPendingPlacement
            ? workbench.saved.anchorSummary
            : placementStatus === 'confirmed'
              ? workbench.saved.summary
              : t('canvas.location.provisionalBody')}
        </span>
        {shown ? (
          <span className={styles.coordinates}>
            {shown.lat.toFixed(6)}, {shown.lon.toFixed(6)}
          </span>
        ) : null}
      </section>

      {/*
        Confirm is the only action that commits. It places at the pending frame
        when one exists and at the current map centre otherwise, which is the
        keyboard-reachable equivalent of clicking the crosshair.
      */}
      <div className={styles.commitActions}>
        <button
          type="button"
          className={styles.primary}
          disabled={!mapHost.canConfirmLocation}
          onClick={() => mapHost.confirmLocation()}
        >
          {t('canvas.location.confirm')}
        </button>
        <button
          type="button"
          className={styles.secondary}
          disabled={!workbench.hasPendingPlacementChange}
          onClick={() => {
            workbench.cancelPlacement()
            setDraft({ lat: '', lon: '' })
          }}
        >
          {t('canvas.location.cancel')}
        </button>
      </div>

      {/* Provider choice stays reachable even when the map cannot load. */}
      <BasemapSettings />

      <button
        type="button"
        className={styles.back}
        onClick={() => navigateTo('canvas')}
        aria-label={t('commands.canvas')}
      >
        {t('commands.canvas')}
      </button>
    </div>
  )
}
