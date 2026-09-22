import { useEffect, useState } from 'preact/hooks'
import {
  analyseLayerAsSlope,
  cancelAnalysisJob,
  runningAnalysisJobId,
} from '../../../app/lidar/actions'
import {
  ensureLidarPolling,
  installLidarLibraryObserver,
  lidarLibrary,
  refreshLidarLibrary,
} from '../../../app/lidar/library-store'
import { t } from '../../../i18n'
import type { LidarLayerSummary } from '../../../ipc/lidar'
import { DockPanelHeader } from '../../shared/DockPanelHeader'
import styles from './analysis-panel.module.css'

/** The only recipe this delivery offers. */
const SLOPE_KIND = 'Slope'

/**
 * An input is slope-eligible when its measurement is ground elevation.
 *
 * The rule is deliberately narrow: height above ground and surface elevation are
 * not ground, so selecting them is refused with the reason shown rather than
 * silently converted. The native analysis path enforces the same rule; this
 * only explains it before the user submits.
 */
function ineligibilityReason(layer: LidarLayerSummary): string | null {
  if (layer.measurement_kind !== 'GroundElevation') {
    return t('canvas.lidar.analysis.notGround')
  }
  if (layer.state !== 'Ready') {
    return t('canvas.lidar.analysis.notReady')
  }
  return null
}

/**
 * The Analysis surface: pick the operation, pick a compatible input, name the
 * result, choose units and run.
 *
 * Jobs belong to the library owner, so closing or switching this panel does not
 * cancel a submitted run; only the explicit Cancel does.
 */
export function AnalysisPanel() {
  useEffect(() => installLidarLibraryObserver(), [])
  const library = lidarLibrary.value
  const [selected, setSelected] = useState<string | null>(null)
  const [unit, setUnit] = useState<'Degrees' | 'Percent'>('Degrees')
  const [error, setError] = useState<string | null>(null)

  const layers = library?.layers ?? []
  const eligible = layers.filter((layer) => ineligibilityReason(layer) === null)
  const chosen = layers.find((layer) => layer.id === selected) ?? null

  // Everything already derived for the chosen input, so Run knows whether a job
  // is in flight and whether the last attempt failed.
  const results = chosen
    ? (library?.analyses ?? []).filter((analysis) => analysis.source_layer_id === chosen.id)
    : []
  const run = results.find(
    (analysis) => analysis.state === 'Preparing' || analysis.state === 'Refreshing',
  ) ?? null
  const previousFailed = results.some((analysis) => analysis.state === 'Failed')

  return (
    <div className={styles.panel}>
      <DockPanelHeader title={t('canvas.lidar.analysis.title')} />
      <div className={styles.body}>
        <p className={styles.intro}>{t('canvas.lidar.analysis.intro')}</p>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <fieldset className={styles.fieldset}>
          <legend>{t('canvas.lidar.analysis.operation')}</legend>
          <label className={styles.choice}>
            <input type="radio" name="analysis-kind" checked readOnly />
            <span>{SLOPE_KIND}</span>
          </label>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend>{t('canvas.lidar.analysis.input')}</legend>
          {layers.length === 0 ? (
            <p className={styles.empty}>{t('canvas.lidar.analysis.noInputs')}</p>
          ) : (
            <ul className={styles.inputs}>
              {layers.map((layer) => {
                const reason = ineligibilityReason(layer)
                return (
                  <li key={layer.id} className={styles.inputRow}>
                    <label className={styles.choice}>
                      <input
                        type="radio"
                        name="analysis-input"
                        value={layer.id}
                        checked={selected === layer.id}
                        disabled={reason !== null}
                        onChange={() => setSelected(layer.id)}
                      />
                      <span className={styles.inputName}>{layer.name}</span>
                    </label>
                    {reason ? (
                      <span className={styles.reason}>{reason}</span>
                    ) : (
                      <span className={styles.units}>{layer.units}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend>{t('canvas.lidar.analysis.units')}</legend>
          <label className={styles.choice}>
            <input
              type="radio"
              name="analysis-unit"
              checked={unit === 'Degrees'}
              onChange={() => setUnit('Degrees')}
            />
            <span>{t('canvas.lidar.analysis.degrees')}</span>
          </label>
          <label className={styles.choice}>
            <input
              type="radio"
              name="analysis-unit"
              checked={unit === 'Percent'}
              onChange={() => setUnit('Percent')}
            />
            <span>{t('canvas.lidar.analysis.percent')}</span>
          </label>
        </fieldset>

        {run ? (
          <div className={styles.run} role="status">
            <span className={styles.runState}>{t(`canvas.lidar.state.${run.state}`)}</span>
            {/* Cancel names the run this session started, never a guessed job. */}
            <button
              type="button"
              className={styles.secondary}
              disabled={!runningAnalysisJobId(run.id)}
              onClick={() => {
                if (chosen === null) return
                void cancelAnalysisJob(run.id).then(() => refreshLidarLibrary())
              }}
            >
              {t('canvas.lidar.cancelCreate')}
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className={styles.primary}
          disabled={chosen === null || run !== null}
          onClick={() => {
            if (chosen === null) return
            setError(null)
            // A fresh job against the current head; the previous definition keeps
            // its own result until this one publishes.
            analyseLayerAsSlope(chosen.id, unit)
              .then(() => ensureLidarPolling())
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              )
          }}
        >
          {run !== null
            ? t('canvas.lidar.analysis.running')
            : previousFailed
              ? t('canvas.lidar.analysis.retry')
              : t('canvas.lidar.createSlope')}
        </button>

        {chosen === null ? null : (
          <section className={styles.previous} aria-label={t('canvas.lidar.analysis.previous')}>
            <h4 className={styles.previousHeading}>{t('canvas.lidar.analysis.previous')}</h4>
            {results.length === 0 ? (
              <p className={styles.empty}>{t('canvas.lidar.analysis.noResults')}</p>
            ) : (
              <ul className={styles.previousList}>
                {results.map((result) => (
                  <li key={result.id} className={styles.previousRow}>
                    <span className={styles.previousState}>
                      {t(`canvas.lidar.state.${result.state}`)}
                    </span>
                    {/* The previous result stays visible while a refresh runs or
                        after a failure, so a reader never loses the last good
                        numbers to an unrelated error. */}
                    {result.value_range ? (
                      <span className={styles.previousRange}>
                        {formatRange(result.value_range)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {eligible.length === 0 && layers.length > 0 ? (
          <p className={styles.empty}>{t('canvas.lidar.analysis.noEligible')}</p>
        ) : null}
      </div>
    </div>
  )
}

/** A result's observed range, which is what a legend would show. */
function formatRange(range: readonly [number, number]): string {
  const [min, max] = range
  if (!Number.isFinite(min) || !Number.isFinite(max)) return ''
  return `${min.toFixed(2)} – ${max.toFixed(2)}`
}
