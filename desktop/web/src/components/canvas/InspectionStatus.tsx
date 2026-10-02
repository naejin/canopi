import { useEffect } from 'preact/hooks'
import { t } from '../../i18n'
import { ESCAPE_PRIORITY, registerEscapeLayer } from '../../app/keyboard/escape-chain'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import {
  endInspection,
  inspectionLocation,
  inspectionSample,
  inspectionTarget,
  sampleInspectionCentre,
} from '../../app/lidar/inspection'
import { formatRasterSample } from '../../app/lidar/display-legend'
import { locale } from '../../app/settings/state'
import styles from './inspection-status.module.css'

/**
 * The read-only result of numeric inspection.
 *
 * It shows the inspected layer, where the sample was taken and what the native
 * read returned. Nothing here is editable and nothing here is saved into a
 * Design: inspection is a read of immutable generation bytes, so it has no
 * document state to persist.
 *
 * Escape leaves inspection, which is the keyboard dismissal the contract
 * requires: the Esc chain's lowest layer, so an Esc first closes a popover,
 * cancels the map's drag or tool and clears its selection.
 */
export function InspectionStatus() {
  const target = inspectionTarget.value
  const sample = inspectionSample.value
  const location = inspectionLocation.value

  useEffect(() => {
    if (!target) return
    return registerEscapeLayer({
      id: 'inspection',
      priority: ESCAPE_PRIORITY.inspection,
      isActive: () => true,
      escape: () => {
        endInspection()
        return true
      },
    })
  }, [target])

  // Workspace teardown — including navigating away from the canvas to Location —
  // ends the session and releases its gesture, so no handler or pending lookup
  // outlives the surface that owned it.
  useEffect(() => () => endInspection(), [])

  if (!target) return null

  return (
    <section className={styles.status} aria-live="polite" aria-label={t('canvas.rasterSample.title')}>
      <div className={styles.heading}>
        <strong>{t('canvas.rasterSample.title')}</strong>
        <span className={styles.layer}>{target.name}</span>
        <button
          type="button"
          className={styles.dismiss}
          onClick={() => endInspection()}
          aria-label={t('canvas.rasterSample.stop')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="m6 6 12 12M6 18 18 6" />
          </svg>
          <ButtonTooltip label={t('canvas.rasterSample.stop')} side="top" />
        </button>
      </div>
      <div className={styles.readout}>
        {sample.kind === 'idle' ? (
          <span className={styles.hint}>{t('canvas.rasterSample.aimHint')}</span>
        ) : sample.kind === 'loading' ? (
          <span className={styles.hint}>{t('canvas.rasterSample.loading')}</span>
        ) : sample.kind === 'value' ? (
          <>
            <span className={styles.value}>
              {formatRasterSample(sample.value, locale.value)}
            </span>
            <span className={styles.units}>{sample.units}</span>
          </>
        ) : sample.kind === 'no-data' ? (
          <span className={styles.noData}>{t('canvas.rasterSample.noData')}</span>
        ) : sample.kind === 'stale' ? (
          <span className={styles.stale}>{t('canvas.rasterSample.stale')}</span>
        ) : (
          <span className={styles.noData}>{t('canvas.rasterSample.unavailable')}</span>
        )}
      </div>
      {/*
        The keyboard half of the same command the canvas pointer invokes: a
        focusable control that samples whatever the viewport is centred on.
      */}
      <button
        type="button"
        className={styles.centreButton}
        onClick={() => sampleInspectionCentre()}
      >
        {t('canvas.rasterSample.sampleCentre')}
      </button>
      {location ? (
        <span className={styles.location}>
          {location.lat.toFixed(6)}, {location.lon.toFixed(6)}
        </span>
      ) : null}
      <span className={styles.escapeHint}>{t('canvas.rasterSample.escapeHint')}</span>
    </section>
  )
}
