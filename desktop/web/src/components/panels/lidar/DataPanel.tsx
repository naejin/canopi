import { useEffect, useState } from 'preact/hooks'
import {
  cancelOpenImport,
  chooseImportFiles,
  deleteLidarLayer,
  fetchLidarLayerDeleteImpact,
  importSourcesIntoLayer,
  importSourcesIntoNewLayer,
  presentEntity,
  renameLidarLayer,
} from '../../../app/lidar/actions'
import {
  installLidarLibraryObserver,
  lidarLibrary,
  lidarStatusMessage,
  openImportJob,
} from '../../../app/lidar/library-store'
import { t } from '../../../i18n'
import type { LidarDeleteImpact } from '../../../ipc/lidar'
import type { LidarImportJob } from '../../../generated/contracts'
import { ActionMenu } from '../../shared/ActionMenu'
import { DockPanelHeader } from '../../shared/DockPanelHeader'
import styles from './data-panel.module.css'

/** Which secondary view one row currently shows. */
type RowMode = 'none' | 'rename' | 'delete'

/**
 * Reusable library datasets.
 *
 * This surface owns the library, not the Design: renaming a dataset or deleting
 * it does not dirty a Design, while "Add to Design" writes a presentation
 * reference through Design Edit. Import review stays on the ordered
 * staging/confirmation route, which this panel starts rather than duplicating.
 */
export function DataPanel() {
  useEffect(() => installLidarLibraryObserver(), [])
  const library = lidarLibrary.value
  const [row, setRow] = useState<{ id: string; mode: RowMode } | null>(null)
  /**
   * Files the user chose, with the interpretation still to confirm.
   *
   * The chooser comes first and creates nothing, so cancelling it leaves no
   * dataset, job or asset behind. Holding the selection here is what lets the
   * form below ask how the values are measured *after* the user has seen what
   * they picked.
   */
  const [selection, setSelection] = useState<{
    readonly paths: string[]
    /** The dataset this batch targets, or null for a new one. */
    readonly layer: { readonly id: string; readonly name: string } | null
  } | null>(null)
  const [newDatasetName, setNewDatasetName] = useState('')
  const [draftKind, setDraftKind] = useState<MeasurementKind | null>(null)
  const [unitLabel, setUnitLabel] = useState('')
  const [unitUnknown, setUnitUnknown] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [impact, setImpact] = useState<LidarDeleteImpact | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * Whether an import submission is in flight.
   *
   * Guards the commit path so an unguarded double click cannot create duplicate
   * datasets or submit the same batch twice. Released on every terminal path so
   * a failed submission leaves the form retryable rather than permanently stuck.
   */
  const [submitting, setSubmitting] = useState(false)

  const closeRow = () => {
    setRow(null)
    setDraftName('')
    setImpact(null)
  }

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className={styles.panel}>
      <DockPanelHeader title={t('canvas.lidar.data.title')} count={library?.layers.length} />
      <div className={styles.body}>
        <p className={styles.intro}>{t('canvas.lidar.data.intro')}</p>

        {/*
          Data's primary action is importing sources. Creating the dataset first
          is what makes the interpretation an explicit choice rather than a
          filename guess, so the form asks for it before any file is opened.
        */}
        {/*
          Data's primary action is importing sources, and it opens the chooser
          first: cancelling it creates nothing, and the interpretation is asked
          for only once the user knows what they selected. Import is the commit
          intent — there is no preview and no second Apply decision.
        */}
        {selection === null ? (
          <div className={styles.rowActions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() =>
                void run(async () => {
                  const paths = await chooseImportFiles()
                  if (paths === null) return
                  setNewDatasetName(suggestedDatasetName(paths))
                  setDraftKind(null)
                  setSelection({ paths, layer: null })
                })
              }
            >
              {t('canvas.lidar.data.importSources')}
            </button>
          </div>
        ) : (
          <form
            className={styles.inlineForm}
            onSubmit={(event) => {
              event.preventDefault()
              if (submitting) return
              if (selection.layer !== null) {
                const target = selection.layer
                const paths = selection.paths
                setSubmitting(true)
                setError(null)
                void (async () => {
                  try {
                    await importSourcesIntoLayer(target.id, paths)
                    setSelection(null)
                  } catch (cause) {
                    // Keep the chosen files so the user can retry immediately.
                    setError(cause instanceof Error ? cause.message : String(cause))
                  } finally {
                    setSubmitting(false)
                  }
                })()
                return
              }
              const name = newDatasetName.trim()
              // Interpretation stays unselected until the user chooses one, so
              // a filename can never decide the measurement type.
              if (name.length === 0 || draftKind === null) return
              if (draftKind === 'OtherContinuous' && unitLabel.trim().length === 0 && !unitUnknown) {
                return
              }
              const paths = selection.paths
              const kind = draftKind
              const unit = { label: unitLabel.trim() || null, unknown: unitUnknown }
              setSubmitting(true)
              setError(null)
              void (async () => {
                try {
                  await importSourcesIntoNewLayer(paths, name, kind, unit)
                  setSelection(null)
                  setNewDatasetName('')
                  setDraftKind(null)
                  setUnitLabel('')
                  setUnitUnknown(false)
                } catch (cause) {
                  // Leave the chosen files and interpretation in place so the
                  // user can retry without re-choosing or losing the measurement.
                  setError(cause instanceof Error ? cause.message : String(cause))
                } finally {
                  setSubmitting(false)
                }
              })()
            }}
          >
            <p className={styles.selectedFiles}>
              {t('canvas.lidar.data.selectedFiles', { count: selection.paths.length })}
            </p>
            <ul className={styles.fileList}>
              {selection.paths.map((path) => (
                <li key={path}>{path.split('/').pop()}</li>
              ))}
            </ul>
            {selection.layer === null ? (
              <>
                <label className={styles.field}>
                  <span>{t('canvas.lidar.data.datasetName')}</span>
                  <input
                    type="text"
                    value={newDatasetName}
                    onInput={(event) => setNewDatasetName(event.currentTarget.value)}
                  />
                </label>
                <fieldset className={styles.fieldset}>
                  <legend>{t('canvas.lidar.data.interpretation')}</legend>
                  {MEASUREMENT_KINDS.map((kind) => (
                    <label key={kind} className={styles.choice}>
                      <input
                        type="radio"
                        name="dataset-kind"
                        checked={draftKind === kind}
                        onChange={() => setDraftKind(kind)}
                      />
                      <span>{t(`canvas.lidar.kind.${kind}`)}</span>
                    </label>
                  ))}
                </fieldset>
                {draftKind === 'OtherContinuous' ? (
                  <>
                    <label className={styles.field}>
                      <span>{t('canvas.lidar.data.unitLabel')}</span>
                      <input
                        type="text"
                        value={unitLabel}
                        disabled={unitUnknown}
                        onInput={(event) => setUnitLabel(event.currentTarget.value)}
                      />
                    </label>
                    <label className={styles.choice}>
                      <input
                        type="checkbox"
                        checked={unitUnknown}
                        onChange={(event) => setUnitUnknown(event.currentTarget.checked)}
                      />
                      <span>{t('canvas.lidar.data.unitUnknown')}</span>
                    </label>
                  </>
                ) : null}
              </>
            ) : (
              // An existing dataset already declares how its values are
              // measured, so that interpretation is reused and only the files
              // are new.
              <p className={styles.note}>
                {t('canvas.lidar.data.reusesInterpretation', { dataset: selection.layer.name })}
              </p>
            )}
            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.primary}
                disabled={
                  submitting
                  || (selection.layer === null
                    && (draftKind === null
                      || (draftKind === 'OtherContinuous'
                        && unitLabel.trim().length === 0
                        && !unitUnknown)))
                }
              >
                {t('canvas.lidar.data.importConfirm')}
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  setSelection(null)
                  setNewDatasetName('')
                  setDraftKind(null)
                  setUnitLabel('')
                  setUnitUnknown(false)
                }}
              >
                {t('canvas.lidar.cancelCreate')}
              </button>
            </div>
          </form>
        )}
        {lidarStatusMessage.value ? (
          <p className={styles.error} role="status">
            {lidarStatusMessage.value}
          </p>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {library === null ? (
          <p className={styles.empty}>{t('canvas.lidar.loadingHistory')}</p>
        ) : library.layers.length === 0 ? (
          <p className={styles.empty}>{t('canvas.lidar.data.empty')}</p>
        ) : (
          <ul className={styles.rows}>
            {library.layers.map((layer) => {
              const mode = row?.id === layer.id ? row.mode : 'none'
              return (
                <li key={layer.id} className={styles.row}>
                  <div className={styles.rowHead}>
                    <span className={styles.rowName}>{layer.name}</span>
                    <ActionMenu
                      label={t('canvas.lidar.actions')}
                      items={[
                        {
                          label: t('canvas.lidar.data.addToDesign'),
                          run: () => void run(() => presentEntity('Source', layer.id)),
                        },
                        {
                          label: t('canvas.lidar.data.rename'),
                          run: () => {
                            setDraftName(layer.name)
                            setRow({ id: layer.id, mode: 'rename' })
                          },
                        },
                        {
                          label: t('canvas.lidar.deleteFromLibrary'),
                          danger: true,
                          run: () =>
                            void run(async () => {
                              setImpact(await fetchLidarLayerDeleteImpact(layer.id))
                              setRow({ id: layer.id, mode: 'delete' })
                            }),
                        },
                      ]}
                    />
                  </div>
                  <dl className={styles.facts}>
                    <dt>{t('canvas.lidar.data.measurement')}</dt>
                    <dd>{t(`canvas.lidar.kind.${layer.measurement_kind}`)}</dd>
                    <dt>{t('canvas.lidar.coverage')}</dt>
                    <dd>
                      {layer.coverage_cells === null
                        ? t('canvas.lidar.notCalculated')
                        : formatCoverage(Number(layer.coverage_cells), layer.resolution_m)}
                    </dd>
                    <dt>{t('canvas.lidar.data.state')}</dt>
                    <dd>{t(`canvas.lidar.state.${layer.state}`)}</dd>
                    <dt>{t('canvas.lidar.data.analyses')}</dt>
                    <dd>{layer.analysis_count}</dd>
                  </dl>
                  {mode === 'rename' ? (
                    <form
                      className={styles.inlineForm}
                      onSubmit={(event) => {
                        event.preventDefault()
                        const name = draftName.trim()
                        if (name.length === 0) return
                        void run(async () => {
                          await renameLidarLayer(layer.id, name)
                          closeRow()
                        })
                      }}
                    >
                      <label className={styles.field}>
                        <span>{t('canvas.lidar.data.rename')}</span>
                        <input
                          type="text"
                          value={draftName}
                          onInput={(event) => setDraftName(event.currentTarget.value)}
                        />
                      </label>
                      <div className={styles.formActions}>
                        <button type="submit" className={styles.primary}>
                          {t('canvas.lidar.data.renameConfirm')}
                        </button>
                        <button type="button" className={styles.secondary} onClick={closeRow}>
                          {t('canvas.lidar.cancelCreate')}
                        </button>
                      </div>
                    </form>
                  ) : null}
                  {mode === 'delete' ? (
                    <div className={styles.inlineForm}>
                      <p className={styles.warning}>
                        {impact === null
                          ? t('canvas.lidar.loadingImpact')
                          : t('canvas.lidar.data.deleteImpact', {
                              analyses: String(impact.analysis_count),
                            })}
                      </p>
                      <p className={styles.note}>{t('canvas.lidar.otherDesignCaveat')}</p>
                      <div className={styles.formActions}>
                        <button
                          type="button"
                          className={styles.danger}
                          disabled={impact === null}
                          onClick={() =>
                            void run(async () => {
                              await deleteLidarLayer(layer.id, impact?.analysis_ids ?? [])
                              closeRow()
                            })
                          }
                        >
                          {t('canvas.lidar.deleteFromLibrary')}
                        </button>
                        <button type="button" className={styles.secondary} onClick={closeRow}>
                          {t('canvas.lidar.cancelCreate')}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {/*
                    Preparation progress belongs to the surface that started it.
                    The job itself is owned by the library, so closing this panel
                    leaves it running and reopening shows it again; the user does
                    not have to find another panel to finish or cancel an import.
                  */}
                  {openImportJob.value?.layer_id === layer.id ? (
                    <ImportJobStatus
                      job={openImportJob.value}
                      onCancel={() => void run(() => cancelOpenImport())}
                    />
                  ) : null}
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={isImportActive(openImportJob.value, layer.id)}
                      onClick={() =>
                        void run(async () => {
                          const paths = await chooseImportFiles()
                          if (paths === null) return
                          setSelection({
                            paths,
                            layer: { id: layer.id, name: layer.name },
                          })
                        })
                      }
                    >
                      {openImportJob.value?.layer_id === layer.id
                        && openImportJob.value.state === 'Failed'
                        ? t('canvas.lidar.data.retryImport')
                        : t('canvas.lidar.addTiffs')}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * A dataset name suggested from the first chosen file.
 *
 * The suggestion is editable and never decides the interpretation, so it is
 * only a convenience: an empty suggestion leaves the field for the user.
 */
function suggestedDatasetName(paths: readonly string[]): string {
  const first = paths[0]?.split('/').pop() ?? ''
  const stem = first.replace(/\.[^.]+$/, '').trim()
  return stem
}

/** Whether one layer's import job is still doing work. */
function isImportActive(job: LidarImportJob | null, layerId: string): boolean {
  if (!job || job.layer_id !== layerId) return false
  return job.state === 'Staging' || job.state === 'Applying'
}

/**
 * One layer's import job: its phase, its progress, its outcome and the two
 * actions that end it — Cancel while it runs, and Retry once it failed.
 */
function ImportJobStatus({
  job,
  onCancel,
}: {
  readonly job: LidarImportJob
  readonly onCancel: () => void
}) {
  const active = job.state === 'Staging' || job.state === 'Applying'
  return (
    <div className={styles.importStatus} role="status">
      <span className={styles.importState}>
        {active ? t('canvas.lidar.data.importing') : t(`canvas.lidar.jobState.${job.state}`)}
      </span>
      {job.progress ? (
        <progress
          className={styles.importProgress}
          max={100}
          value={job.progress.percent}
          aria-label={t('canvas.lidar.data.importing')}
        />
      ) : null}
      {job.state === 'Failed' ? (
        <p className={styles.error} role="alert">
          {t('canvas.lidar.data.importFailed', { reason: job.message ?? '' })}
        </p>
      ) : null}
      {active ? (
        <button type="button" className={styles.secondary} onClick={onCancel}>
          {t('canvas.lidar.cancelCreate')}
        </button>
      ) : null}
    </div>
  )
}

/** The interpretations this delivery can import, in the contract's order. */
const MEASUREMENT_KINDS = [
  'GroundElevation',
  'SurfaceElevation',
  'AboveGroundHeight',
  'OtherContinuous',
] as const

type MeasurementKind = (typeof MEASUREMENT_KINDS)[number]

/**
 * Coverage as an area, using the layer's own resolution when it is known.
 *
 * `coverage_cells` is a cell count, so the area needs the cell size: a 0.5 m
 * grid is four cells to the square metre and 10,000 m2 to the hectare.
 */
function formatCoverage(cells: number, resolutionMetres: number | null = 0.5): string {
  const cellArea = (resolutionMetres ?? 0.5) ** 2
  const hectares = (cells * cellArea) / 10_000
  return `${hectares.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha`
}
