import { useEffect, useState } from 'preact/hooks'
import {
  analyseLayerAsSlope,
  cancelAnalysisJob,
  retryAnalysis,
  runningAnalysisJobId,
} from '../../../app/lidar/actions'
import {
  ensureLidarPolling,
  installLidarLibraryObserver,
  lidarLibrary,
  lidarStatusMessage,
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
  const [resultName, setResultName] = useState('')
  const [error, setError] = useState<string | null>(null)
  /**
   * A submitted run that has not settled yet.
   *
   * The library snapshot only reports Preparing after a refresh, so a second
   * click during the initial request would start a duplicate definition. This
   * latch closes that window without tying job ownership to this panel: the job
   * itself keeps running when the panel unmounts.
   */
  const [submitting, setSubmitting] = useState(false)

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

  return (
    <div className={styles.panel}>
      <DockPanelHeader title={t('canvas.lidar.analysis.title')} />
      <div className={styles.body}>
        <p className={styles.intro}>{t('canvas.lidar.analysis.intro')}</p>
        {/*
          One existing error path: the action publishes its failure to the shared
          status and re-throws, so this shows the same text whichever way it is
          read, and a failed Run can no longer settle silently.
        */}
        {error ?? lidarStatusMessage.value ? (
          <p className={styles.error} role="alert">
            {error ?? lidarStatusMessage.value}
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

        <label className={styles.field}>
          <span>{t('canvas.lidar.analysis.resultName')}</span>
          <input
            type="text"
            value={resultName}
            // Optional by design: an empty field publishes an unnamed
            // result that the panel shows by kind, rather than inventing a name.
            onInput={(event) => setResultName(event.currentTarget.value)}
          />
        </label>

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
          disabled={chosen === null || run !== null || submitting}
          onClick={() => {
            if (chosen === null || submitting) return
            setError(null)
            setSubmitting(true)
            // Create always uses the form; Retry lives on each failed row.
            // A blank field stays unnamed rather than becoming the empty string.
            analyseLayerAsSlope(chosen.id, unit, resultName.trim() || null)
              .then(() => ensureLidarPolling())
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              )
              .finally(() => setSubmitting(false))
          }}
        >
          {submitting || run !== null
            ? t('canvas.lidar.analysis.running')
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
                    {/* The author's stored name identifies this definition. */}
                    {result.name ? (
                      <span className={styles.previousName}>{result.name}</span>
                    ) : null}
                    {/* The previous result stays visible while a refresh runs or
                        after a failure, so a reader never loses the last good
                        numbers to an unrelated error. */}
                    {/* The row states the unit the result was actually
                        computed in, so a percent slope is never labelled as
                        degrees. */}
                    <span className={styles.previousUnits}>
                      {result.slope_unit === 'Percent'
                        ? t('canvas.lidar.analysis.percent')
                        : t('canvas.lidar.analysis.degrees')}
                    </span>
                    {result.value_range ? (
                      <span className={styles.previousRange}>
                        {formatRange(result.value_range)}
                      </span>
                    ) : null}
                    {result.state === 'Failed' ? (
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={submitting || run !== null}
                        onClick={() => {
                          if (submitting || chosen === null) return
                          // Retry this row's definition with its saved
                          // parameters/name and the currently observed source
                          // head; the create form is not consulted.
                          const sourceLayer = layers.find(
                            (layer) => layer.id === result.source_layer_id,
                          )
                          const sourceTileset = sourceLayer?.tilesets.find(
                            (tileset) => tileset.source.kind === 'native-generation',
                          )
                          const expectedSourceGenerationId =
                            sourceTileset && 'generation_id' in sourceTileset.source
                              ? sourceTileset.source.generation_id
                              : null
                          if (!expectedSourceGenerationId) {
                            setError(t('canvas.lidar.analysis.retryNeedsHead'))
                            return
                          }
                          setError(null)
                          setSubmitting(true)
                          retryAnalysis(result.id, expectedSourceGenerationId)
                            .then(() => ensureLidarPolling())
                            .catch((cause: unknown) =>
                              setError(
                                cause instanceof Error ? cause.message : String(cause),
                              ),
                            )
                            .finally(() => setSubmitting(false))
                        }}
                      >
                        {t('canvas.lidar.analysis.retry')}
                      </button>
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
