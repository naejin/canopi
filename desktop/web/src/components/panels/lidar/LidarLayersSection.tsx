import { convertFileSrc } from '@tauri-apps/api/core'
import { useEffect, useState } from 'preact/hooks'
import { currentDesign } from '../../../app/document-session/store'
import {
  importPanelOpen,
  lidarLibrary,
  lidarStatusMessage,
  dismissTrackedImport,
  hideTrackedImport,
  openImportJob,
  readLidarPresentation,
  showTrackedImport,
  type LidarPresentationItem,
} from '../../../app/lidar/library-store'
import {
  analyseLayerAsSlope,
  applyOpenImport,
  cancelOpenImport,
  createLidarLayer,
  deleteLidarAnalysis,
  deleteLidarLayer,
  fetchLayerCollection,
  fetchLayerHistory,
  fetchLidarLayerDeleteImpact,
  moveLayerSource,
  removeLayerSource,
  restoreLayerVersion,
  undoLayerChange,
  previewOpenImportDecision,
  setLidarEntryOpacity,
  setLidarEntryVisibility,
  startImportForLayer,
} from '../../../app/lidar/actions'
import {
  lidarMapViewBounds,
  viewDesignLocation,
  viewLidarCoverage,
} from '../../../app/lidar/camera-request'
import { t } from '../../../i18n'
import type {
  LidarDeleteImpact,
  LidarGenerationHistoryEntry,
  LidarImportDecisionPreview,
  LidarLayerCollection,
} from '../../../ipc/lidar'
import { LayerVisibilityIcon } from '../../canvas/LayerPanel'
import layerStyles from '../../canvas/LayerPanel.module.css'
import { ActionMenu } from '../../shared/ActionMenu'
import { ButtonTooltip } from '../../shared/ButtonTooltip'
import { DockPanelHeader } from '../../shared/DockPanelHeader'
import styles from './lidar-layers-section.module.css'

type DetailMode = 'settings' | 'history' | 'delete'

export function LidarLayersSection() {
  const library = lidarLibrary.value
  const trackedImport = openImportJob.value
  const items = readLidarPresentation(currentDesign.value, library)
  const sources = items.filter((item) => item.kind === 'Source')
  const analysesById = new Map(
    items.filter((item) => item.kind === 'Analysis').map((item) => [item.id, item]),
  )
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [mode, setMode] = useState<DetailMode>('settings')
  const [history, setHistory] = useState<LidarGenerationHistoryEntry[] | null>(null)
  const [collection, setCollection] = useState<LidarLayerCollection | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [deleteImpact, setDeleteImpact] = useState<LidarDeleteImpact | null>(null)
  const [analysisDeleteId, setAnalysisDeleteId] = useState<string | null>(null)
  const [showReturnToLocation, setShowReturnToLocation] = useState(false)

  const selected = items.find((item) => item.id === selectedId) ?? sources[0] ?? null
  const selectedLayer = selected?.kind === 'Source'
    ? library?.layers.find((layer) => layer.id === selected.id)
    : null
  const selectedAnalysis = selected?.kind === 'Analysis'
    ? library?.analyses.find((analysis) => analysis.id === selected.id)
    : null
  const engineUnavailable = library !== null && !library.engine.available

  const select = (id: string): void => {
    setSelectedId(id)
    setMode('settings')
    setHistory(null)
    setCollection(null)
    setConfirmRemove(null)
    setDeleteImpact(null)
    setAnalysisDeleteId(null)
  }

  /** Re-read the ordered composition the head the backend settled on. */
  const loadCollection = (layerId: string): void => {
    setCollection(null)
    void fetchLayerCollection(layerId)
      .then(setCollection)
      .catch((error) => {
        lidarStatusMessage.value = error instanceof Error ? error.message : String(error)
      })
  }

  // The priority list is library data, so it is re-read whenever the library
  // snapshot settles: a reorder, remove, Undo or a completed import all publish
  // a new head, and the list must show that head rather than the one the panel
  // happened to load first.
  useEffect(() => {
    if (mode !== 'settings' || selected?.kind !== 'Source') return
    loadCollection(selected.id)
  }, [mode, selected?.id, library])

  const runEdit = (layerId: string, work: Promise<void>): void => {
    void work
      .then(() => loadCollection(layerId))
      .catch((error) => {
        lidarStatusMessage.value = error instanceof Error ? error.message : String(error)
        loadCollection(layerId)
      })
  }

  const submitCreate = (): void => {
    const name = newName.trim()
    if (!name) return
    setCreating(false)
    setNewName('')
    void createLidarLayer(name, 'GroundElevation')
  }

  const openHistory = (item: LidarPresentationItem): void => {
    select(item.id)
    setMode('history')
    setHistory(null)
    setCollection(null)
    void fetchLayerHistory(item.id)
      .then(setHistory)
      .catch((error) => {
        lidarStatusMessage.value = error instanceof Error ? error.message : String(error)
      })
    void fetchLayerCollection(item.id)
      .then(setCollection)
      .catch(() => setCollection(null))
  }

  const openLayerDelete = (item: LidarPresentationItem): void => {
    select(item.id)
    setMode('delete')
    setDeleteImpact(null)
    void fetchLidarLayerDeleteImpact(item.id)
      .then(setDeleteImpact)
      .catch((error) => {
        lidarStatusMessage.value = error instanceof Error ? error.message : String(error)
        setMode('settings')
      })
  }

  return (
    <section className={styles.section} aria-label={t('canvas.lidar.section')}>
      <div className={styles.groupHeading}>
        <h3>{t('canvas.lidar.section')} <span>{sources.length}</span></h3>
        <button
          type="button"
          className={styles.addButton}
          onClick={() => setCreating((value) => !value)}
        >
          {creating ? t('canvas.lidar.cancelCreate') : t('canvas.lidar.addLayer')}
        </button>
      </div>
      {engineUnavailable && (
        <p className={styles.engineWarning}>{t('canvas.lidar.engineUnavailable')}</p>
      )}
      {lidarStatusMessage.value && (
        <p className={styles.errorMessage} role="status">{lidarStatusMessage.value}</p>
      )}
      {creating && (
        <div className={styles.createForm}>
          <label className={styles.srOnly} for="lidar-layer-name">
            {t('canvas.lidar.layerNamePlaceholder')}
          </label>
          <input
            id="lidar-layer-name"
            className={styles.nameInput}
            value={newName}
            placeholder={t('canvas.lidar.layerNamePlaceholder')}
            autoFocus
            onInput={(event) => setNewName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitCreate()
              if (event.key === 'Escape') setCreating(false)
            }}
          />
          <button type="button" className={styles.createButton} onClick={submitCreate}>
            {t('canvas.lidar.createLayer')}
          </button>
        </div>
      )}
      {trackedImport !== null && !importPanelOpen.value && (
        <button type="button" className={styles.pendingReview} onClick={showTrackedImport}>
          <span>
            {trackedImport.progress
              ? `${t(`canvas.lidar.progressPhase.${trackedImport.progress.phase}`)} · ${trackedImport.progress.percent}%`
              : t(`canvas.lidar.jobState.${trackedImport.state}`)}
          </span>
          <span>{t('canvas.lidar.openImport')}</span>
        </button>
      )}
      <div className={styles.layerList} role="list">
        {sources.map((item) => {
          const results = (library?.analyses ?? [])
            .filter((analysis) => analysis.source_layer_id === item.id)
            .flatMap((analysis) => {
              const presented = analysesById.get(analysis.id)
              return presented ? [presented] : []
            })
          const isCollapsed = collapsed.has(item.id)
          const layer = library?.layers.find((candidate) => candidate.id === item.id)
          return (
            <div key={item.id} className={styles.sourceGroup}>
              <div
                className={styles.layerRow}
                data-selected={selected?.id === item.id}
                data-hidden={!item.visible}
                role="listitem"
              >
                <button
                  type="button"
                  className={styles.disclosure}
                  aria-label={isCollapsed ? t('canvas.lidar.expand') : t('canvas.lidar.collapse')}
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed((current) => {
                    const next = new Set(current)
                    if (next.has(item.id)) next.delete(item.id)
                    else next.add(item.id)
                    return next
                  })}
                >
                  <span aria-hidden="true">{isCollapsed ? '›' : '⌄'}</span>
                </button>
                <VisibilityButton item={item} />
                <button type="button" className={styles.layerIdentity} onClick={() => select(item.id)}>
                  <TerrainIcon />
                  <span className={styles.identityText}>
                    <span className={styles.name}>{item.name}</span>
                    <span className={styles.metadata}>
                      {t(`canvas.lidar.kind.${layer?.measurement_kind ?? item.detail}`)} · {sourceState(item)}
                    </span>
                  </span>
                </button>
                {item.state === 'unavailable' ? <span className={styles.actionSlot} /> : (
                  <ActionMenu label={t('canvas.lidar.actions')} items={[
                    { label: t('canvas.lidar.history'), run: () => openHistory(item) },
                    { label: t('canvas.lidar.deleteFromLibrary'), danger: true, run: () => openLayerDelete(item) },
                  ]} />
                )}
              </div>
              {!isCollapsed && results.map((result) => (
                <div
                  key={result.id}
                  className={`${styles.layerRow} ${styles.analysisRow}`}
                  data-selected={selected?.id === result.id}
                  data-hidden={!result.visible}
                  role="listitem"
                >
                  <span className={styles.disclosureSlot} />
                  <VisibilityButton item={result} />
                  <button type="button" className={styles.layerIdentity} onClick={() => select(result.id)}>
                    <AnalysisIcon />
                    <span className={styles.identityText}>
                      <span className={styles.name}>{result.name}</span>
                      <span className={styles.metadata}>{t('canvas.lidar.slopeDegrees')} · {stateLabel(result.state)}</span>
                    </span>
                  </button>
                  <ActionMenu label={t('canvas.lidar.actions')} items={[
                    {
                      label: t('canvas.lidar.deleteAnalysis'),
                      danger: true,
                      run: () => {
                        select(result.id)
                        setAnalysisDeleteId(result.id)
                        setMode('delete')
                      },
                    },
                  ]} />
                </div>
              ))}
              {isCollapsed && results.length > 0 && (
                <p className={styles.collapsedSummary}>
                  {t('canvas.lidar.collapsedResults', {
                    count: results.length,
                    visible: results.filter((result) => result.visible).length,
                  })}
                </p>
              )}
            </div>
          )
        })}
        {sources.length === 0 && <p className={styles.emptyHint}>{t('canvas.lidar.empty')}</p>}
      </div>
      {selected && (
        <div className={styles.inspector} aria-label={selected.name}>
          <div className={styles.inspectorHeading}>
            {selected.kind === 'Source' ? <TerrainIcon /> : <AnalysisIcon />}
            <h3>{selected.name}</h3>
            <span>{selected.visible ? t('canvas.layers.visible') : t('canvas.layers.hidden')}</span>
          </div>
          {mode === 'history' && selected.kind === 'Source' ? (
            <HistoryDetail
              history={history}
              collection={collection}
              onBack={() => setMode('settings')}
              onUndo={() =>
                runEdit(selected.id, undoLayerChange(selected.id, collection?.head_generation_id ?? null))
              }
              onRestore={(versionId) =>
                runEdit(
                  selected.id,
                  restoreLayerVersion(selected.id, versionId, collection?.head_generation_id ?? null),
                )
              }
            />
          ) : mode === 'delete' ? (
            <DeleteDetail
              item={selected}
              impact={deleteImpact}
              analysisId={analysisDeleteId}
              onCancel={() => setMode('settings')}
              onDelete={() => {
                if (analysisDeleteId) void deleteLidarAnalysis(analysisDeleteId)
                else if (deleteImpact) void deleteLidarLayer(selected.id, deleteImpact.analysis_ids)
                setMode('settings')
              }}
            />
          ) : (
            <div className={styles.details}>
              <p className={styles.detailSummary}>
                {selected.kind === 'Source' && selectedLayer
                  ? sourceFacts(selectedLayer.resolution_m, selectedLayer.coverage_cells, selectedLayer.units)
                  : `${t('canvas.lidar.slopeDegrees')} · ${stateLabel(selected.state)}`}
              </p>
              {selectedAnalysis?.detail && <p className={styles.errorMessage}>{selectedAnalysis.detail}</p>}
              {selected.kind === 'Source' && (
                <SourcePriorityList
                  collection={collection}
                  confirmRemove={confirmRemove}
                  onConfirmRemove={setConfirmRemove}
                  onMove={(memberId, towardsTop) =>
                    runEdit(
                      selected.id,
                      moveLayerSource(selected.id, memberId, towardsTop, collection?.head_generation_id ?? null),
                    )
                  }
                  onRemove={(memberId) => {
                    setConfirmRemove(null)
                    runEdit(
                      selected.id,
                      removeLayerSource(selected.id, memberId, collection?.head_generation_id ?? null),
                    )
                  }}
                />
              )}
              <OpacityControl item={selected} />
              {selected.kind === 'Source' && selectedLayer && (
                <SourceActions
                  item={selected}
                  coverageCells={Number(selectedLayer.coverage_cells)}
                  bounds={selected.bounds}
                  engineUnavailable={engineUnavailable}
                  showReturn={showReturnToLocation}
                  onViewedCoverage={() => setShowReturnToLocation(true)}
                />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export function LidarImportPanel() {
  const job = openImportJob.value
  const [addUncovered, setAddUncovered] = useState(true)
  const [replaceOverlap, setReplaceOverlap] = useState(false)
  const [preview, setPreview] = useState<'before' | 'after'>('after')
  const [decisionPreview, setDecisionPreview] = useState<LidarImportDecisionPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)

  useEffect(() => {
    setAddUncovered(true)
    setReplaceOverlap(false)
    setPreview('after')
  }, [job?.job_id])

  useEffect(() => {
    const review = job?.review
    if (job?.state !== 'AwaitingReview' || !review) {
      setDecisionPreview(null)
      setPreviewLoading(false)
      setPreviewFailed(false)
      return
    }
    if (!addUncovered && !replaceOverlap) {
      setDecisionPreview(null)
      setPreviewLoading(false)
      setPreviewFailed(false)
      return
    }
    if (addUncovered && !replaceOverlap) {
      setDecisionPreview({
        add_uncovered: true,
        replace_overlap: false,
        before_preview_path: review.before_preview_path,
        after_preview_path: review.after_preview_path ?? '',
      })
      setPreviewLoading(false)
      setPreviewFailed(false)
      return
    }

    let disposed = false
    setDecisionPreview(null)
    setPreviewLoading(true)
    setPreviewFailed(false)
    const timer = window.setTimeout(() => {
      void previewOpenImportDecision(addUncovered, replaceOverlap)
        .then((result) => {
          if (!disposed) setDecisionPreview(result)
        })
        .catch(() => {
          if (!disposed) setPreviewFailed(true)
        })
        .finally(() => {
          if (!disposed) setPreviewLoading(false)
        })
    }, 200)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [job?.job_id, job?.state, job?.review, addUncovered, replaceOverlap])

  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || job === null) return
      if (!['Staging', 'AwaitingReview', 'Applying'].includes(job.state)) return
      event.preventDefault()
      void cancelOpenImport()
    }
    document.addEventListener('keydown', cancelOnEscape)
    return () => document.removeEventListener('keydown', cancelOnEscape)
  }, [job?.job_id, job?.state])

  if (job === null) return null
  const review = job.review
  const active = job.state === 'Staging' || job.state === 'Applying'
  const progress = active ? job.progress : null
  const progressPercent = progress === null
    ? null
    : Math.max(0, Math.min(100, Math.round(progress.percent)))
  const progressLabel = progress === null
    ? t(`canvas.lidar.jobState.${job.state}`)
    : t(`canvas.lidar.progressPhase.${progress.phase}`)
  const terminal = job.state === 'Complete' || job.state === 'Cancelled' || job.state === 'Failed'
  const previewMatchesDecision = decisionPreview?.add_uncovered === addUncovered
    && decisionPreview?.replace_overlap === replaceOverlap
  const previewPath = preview === 'before'
    ? decisionPreview?.before_preview_path
    : decisionPreview?.after_preview_path || null

  return (
    <aside className={layerStyles.panel} aria-label={t('canvas.lidar.review.title')}>
      <DockPanelHeader
        title={t('canvas.lidar.review.title')}
        actions={(
          <button type="button" className={styles.headerBack} onClick={hideTrackedImport}>
            {t('canvas.lidar.backToLayers')}
          </button>
        )}
      />
      <div className={styles.reviewBody}>
        <section className={styles.reviewSection}>
          <h3>{t(`canvas.lidar.jobState.${job.state}`)}</h3>
          {job.message && <p className={styles.detailSummary}>{job.message}</p>}
          {active && (
            <>
              <div className={styles.progressMeta}>
                <span>{progressLabel}</span>
                {progressPercent !== null && <strong>{progressPercent}%</strong>}
              </div>
              <div
                className={`${styles.progress} ${progressPercent !== null ? styles.progressDeterminate : ''}`}
                role="progressbar"
                aria-label={progressLabel}
                aria-valuemin={progressPercent !== null ? 0 : undefined}
                aria-valuemax={progressPercent !== null ? 100 : undefined}
                aria-valuenow={progressPercent ?? undefined}
              >
                <span style={progressPercent !== null ? { width: `${progressPercent}%` } : undefined} />
              </div>
              <p className={styles.detailSummary}>{t('canvas.lidar.progressBackground')}</p>
            </>
          )}
        </section>
        {review && (
          <>
            <section className={styles.reviewSection}>
              <h3>{t('canvas.lidar.review.sources')}</h3>
              {review.sources.map((source) => (
                <details key={source.sha256} className={styles.sourceFile}>
                  <summary>{source.filename}</summary>
                  <p>{source.width.toLocaleString()} × {source.height.toLocaleString()} · {source.pixel_size_m.toLocaleString()} m</p>
                  {source.issues.map((issue) => <p key={issue} className={styles.errorMessage}>{issue}</p>)}
                </details>
              ))}
            </section>
            <section className={styles.reviewSection}>
              <h3>{t('canvas.lidar.review.coverageChanges')}</h3>
              <dl className={styles.reviewCounts}>
                <div><dt>{t('canvas.lidar.review.uncovered')}</dt><dd>{formatReviewArea(review.uncovered_cells, review.sources[0]?.pixel_size_m)}</dd></div>
                <div><dt>{t('canvas.lidar.review.overlap')}</dt><dd>{formatReviewArea(review.overlap_cells, review.sources[0]?.pixel_size_m)}</dd></div>
                <div><dt>{t('canvas.lidar.review.invalid')}</dt><dd>{Number(review.invalid_cells).toLocaleString()}</dd></div>
              </dl>
              <details className={styles.exactCounts}>
                <summary>{t('canvas.lidar.review.exactCounts')}</summary>
                <p>{t('canvas.lidar.review.uncovered')}: {Number(review.uncovered_cells).toLocaleString()}</p>
                <p>{t('canvas.lidar.review.overlap')}: {Number(review.overlap_cells).toLocaleString()}</p>
                <p>{t('canvas.lidar.review.invalid')}: {Number(review.invalid_cells).toLocaleString()}</p>
              </details>
            </section>
            <section className={styles.reviewSection}>
              <label className={styles.decision}>
                <input type="checkbox" checked={addUncovered} onChange={(event) => setAddUncovered(event.currentTarget.checked)} />
                <span>{t('canvas.lidar.review.addUncovered')}<small>{t('canvas.lidar.review.addUncoveredHint')}</small></span>
              </label>
              <label className={styles.decision}>
                <input
                  type="checkbox"
                  checked={replaceOverlap}
                  disabled={Number(review.overlap_cells) === 0}
                  onChange={(event) => setReplaceOverlap(event.currentTarget.checked)}
                />
                <span>{t('canvas.lidar.review.replaceOverlap')}<small>{Number(review.overlap_cells) === 0 ? t('canvas.lidar.review.noOverlap') : t('canvas.lidar.review.replaceOverlapHint')}</small></span>
              </label>
            </section>
            <section className={styles.reviewSection}>
              <div className={styles.previewTabs}>
                <button type="button" data-active={preview === 'before'} onClick={() => setPreview('before')}>{t('canvas.lidar.review.before')}</button>
                <button type="button" data-active={preview === 'after'} onClick={() => setPreview('after')}>{t('canvas.lidar.review.after')}</button>
              </div>
              {previewLoading ? (
                <p className={styles.previewEmpty} role="status">{t('canvas.lidar.review.previewUpdating')}</p>
              ) : previewFailed ? (
                <p className={styles.errorMessage} role="status">{t('canvas.lidar.review.previewFailed')}</p>
              ) : previewPath ? (
                <img key={previewPath} className={styles.previewImage} src={convertFileSrc(previewPath)} alt={t(`canvas.lidar.review.${preview}`)} />
              ) : (
                <p className={styles.previewEmpty}>
                  {preview === 'before'
                    ? t('canvas.lidar.review.noPreviousCoverage')
                    : t('canvas.lidar.review.previewUpdating')}
                </p>
              )}
              <p className={styles.detailSummary}>{t('canvas.lidar.review.sharedScale')}</p>
            </section>
          </>
        )}
        {job.state === 'Failed' && (
          <section className={styles.reviewSection}>
            <p className={styles.errorMessage}>{job.message ?? t('canvas.lidar.importFailed')}</p>
            <button type="button" className={styles.secondaryButton} onClick={hideTrackedImport}>{t('canvas.lidar.addAgain')}</button>
          </section>
        )}
        {job.state === 'Cancelled' && <p className={styles.reviewSection}>{t('canvas.lidar.cancelledAcknowledgement')}</p>}
        {job.state === 'Complete' && <p className={styles.reviewSection}>{t('canvas.lidar.completeAcknowledgement')}</p>}
      </div>
      <div className={styles.reviewFooter}>
        {job.state === 'AwaitingReview' && review && (
          <button
            type="button"
            className={styles.primaryButton}
            disabled={
              !review.compatible
              || (!addUncovered && !replaceOverlap)
              || previewLoading
              || previewFailed
              || !previewMatchesDecision
            }
            onClick={() => void applyOpenImport(addUncovered, replaceOverlap)}
          >
            {t('canvas.lidar.review.apply')}
          </button>
        )}
        {(active || job.state === 'AwaitingReview') && (
          <button type="button" className={styles.secondaryButton} onClick={() => void cancelOpenImport()}>
            {t('canvas.lidar.review.cancel')}
          </button>
        )}
        {terminal && (
          <button type="button" className={styles.primaryButton} onClick={dismissTrackedImport}>
            {t('canvas.lidar.done')}
          </button>
        )}
      </div>
    </aside>
  )
}

function VisibilityButton({ item }: { readonly item: LidarPresentationItem }) {
  const label = item.visible ? t('canvas.lidar.hide') : t('canvas.lidar.show')
  return (
    <button
      type="button"
      className={styles.eyeButton}
      aria-label={`${label}: ${item.name}`}
      aria-pressed={item.visible}
      onClick={() => setLidarEntryVisibility(item.id, !item.visible)}
    >
      <LayerVisibilityIcon open={item.visible} />
      <ButtonTooltip label={`${label}: ${item.name}`} side="left" />
    </button>
  )
}

function OpacityControl({ item }: { readonly item: LidarPresentationItem }) {
  const value = Math.round(item.opacity * 100)
  return (
    <div className={layerStyles.controlRow}>
      <span className={layerStyles.controlLabel}>
        {t('canvas.lidar.opacity')}
        <output className={layerStyles.opacityValue}>{value}%</output>
      </span>
      <input
        type="range"
        className={layerStyles.mapSlider}
        min="0"
        max="100"
        value={value}
        aria-label={`${t('canvas.lidar.opacity')}: ${item.name}`}
        onInput={(event) => setLidarEntryOpacity(item.id, Number(event.currentTarget.value) / 100)}
      />
    </div>
  )
}

function SourceActions({ item, coverageCells, bounds, engineUnavailable, showReturn, onViewedCoverage }: {
  readonly item: LidarPresentationItem
  readonly coverageCells: number
  readonly bounds: [number, number, number, number] | null
  readonly engineUnavailable: boolean
  readonly showReturn: boolean
  onViewedCoverage(): void
}) {
  const frame = currentDesign.value?.spatial_frame
  const location = frame?.placement_status === 'confirmed'
    ? { lat: frame.anchor_latitude_deg, lon: frame.anchor_longitude_deg }
    : null
  const distance = location && bounds ? distanceToBoundsKm(location.lat, location.lon, bounds) : null
  const outsideView = bounds !== null && lidarMapViewBounds.value !== null
    && !boundsIntersect(bounds, lidarMapViewBounds.value)
  return (
    <>
      {coverageCells === 0 && <p className={styles.emptyState}>{t('canvas.lidar.noTiffs')}</p>}
      {!location && coverageCells > 0 && <p className={styles.notice}>{t('canvas.lidar.locationRequired')}</p>}
      {outsideView && (
        <div className={styles.notice}>
          <p>{t('canvas.lidar.coverageOutsideView')}</p>
          {distance !== null && distance >= 1 && <p>{t('canvas.lidar.coverageDistance', { distance: Math.round(distance) })}</p>}
        </div>
      )}
      {!outsideView && distance !== null && distance >= 1 && (
        <p className={styles.detailSummary}>{t('canvas.lidar.coverageDistance', { distance: Math.round(distance) })}</p>
      )}
      <div className={styles.detailActions}>
        {bounds && <button type="button" className={styles.secondaryButton} onClick={() => {
          viewLidarCoverage(bounds)
          onViewedCoverage()
        }}>{t('canvas.lidar.viewCoverage')}</button>}
        {showReturn && location && <button type="button" className={styles.secondaryButton} onClick={viewDesignLocation}>{t('canvas.lidar.returnToLocation')}</button>}
        <button type="button" className={styles.secondaryButton} disabled={engineUnavailable} onClick={() => void startImportForLayer(item.id)}>{t('canvas.lidar.addTiffs')}</button>
        {item.detail === 'GroundElevation' && coverageCells > 0 && <button type="button" className={styles.secondaryButton} disabled={engineUnavailable} onClick={() => void analyseLayerAsSlope(item.id)}>{t('canvas.lidar.createSlope')}</button>}
      </div>
    </>
  )
}

/**
 * The layer's priority list, topmost first.
 *
 * A source order is shared library data: moving one changes the composition for
 * every design that references the layer, so the panel says so once and never
 * writes a mirrored order into the Design.
 */
function SourcePriorityList({ collection, confirmRemove, onConfirmRemove, onMove, onRemove }: {
  readonly collection: LidarLayerCollection | null
  readonly confirmRemove: string | null
  onConfirmRemove(memberId: string | null): void
  onMove(memberId: string, towardsTop: boolean): void
  onRemove(memberId: string): void
}) {
  if (collection === null) return <p className={styles.detailSummary}>{t('canvas.lidar.loadingSources')}</p>
  return (
    <div className={styles.sourceList}>
      <h4>{t('canvas.lidar.sources')} <span>{collection.sources.length}</span></h4>
      <p className={styles.detailSummary}>{t('canvas.lidar.sourceOrderHint')}</p>
      {collection.sources.length === 0 ? (
        <p className={styles.emptyHint}>{t('canvas.lidar.empty')}</p>
      ) : (
        <ol className={styles.priorityList}>
          {collection.sources.map((source, index) => (
            <li key={source.member_id} className={styles.priorityEntry}>
              <span className={styles.priorityRank}>{index + 1}</span>
              <span className={styles.priorityName}>
                {source.kind === 'previous-composition'
                  ? t('canvas.lidar.previousComposition')
                  : (source.filename ?? t('canvas.lidar.review.sources'))}
                <small>
                  {source.kind === 'previous-composition'
                    ? t('canvas.lidar.previousCompositionHint')
                    : `${Number(source.coverage_cells).toLocaleString()} ${t('canvas.lidar.historyCells')}`}
                </small>
              </span>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t('canvas.lidar.moveUp')}
                disabled={index === 0}
                onClick={() => onMove(source.member_id, true)}
              >↑</button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t('canvas.lidar.moveDown')}
                disabled={index === collection.sources.length - 1}
                onClick={() => onMove(source.member_id, false)}
              >↓</button>
              {confirmRemove === source.member_id ? (
                <span className={styles.confirmRow}>
                  <button type="button" className={styles.dangerButton} onClick={() => onRemove(source.member_id)}>
                    {t('canvas.lidar.removeSourceConfirmAction')}
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={() => onConfirmRemove(null)}>
                    {t('canvas.lidar.review.cancel')}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => onConfirmRemove(source.member_id)}
                >{t('canvas.lidar.removeSource')}</button>
              )}
              {confirmRemove === source.member_id && (
                <span className={styles.confirmHint}>{t('canvas.lidar.removeSourceConfirm')}</span>
              )}
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={!collection.can_undo}
        onClick={undoLayerChangeFromHistory(collection)}
      >{t('canvas.lidar.undoLastChange')}</button>
      <p className={styles.detailSummary}>{t('canvas.lidar.libraryOrderNote')}</p>
    </div>
  )
}

/** Undo is exposed on the version list; this keeps the settings list honest. */
function undoLayerChangeFromHistory(collection: LidarLayerCollection): () => void {
  return () => {
    void undoLayerChange(collection.layer_id, collection.head_generation_id)
  }
}

/**
 * Published versions of the layer, newest first.
 *
 * Each entry carries the user operation and its publication time with the
 * generation's own identity, so two consecutive imports never read alike.
 * Restoring publishes a new head and deletes nothing.
 */
function HistoryDetail({ history, collection, onBack, onUndo, onRestore }: {
  readonly history: LidarGenerationHistoryEntry[] | null
  readonly collection: LidarLayerCollection | null
  onBack(): void
  onUndo(): void
  onRestore(versionId: string): void
}) {
  const head = history?.find((entry) => entry.is_head) ?? null
  return (
    <div className={styles.details}>
      <button type="button" className={styles.textButton} onClick={onBack}>‹ {t('canvas.lidar.backToSettings')}</button>
      <h4>{t('canvas.lidar.history')}</h4>
      <button type="button" className={styles.secondaryButton} disabled={!(collection?.can_undo ?? false)} onClick={onUndo}>
        {t('canvas.lidar.undoLastChange')}
      </button>
      {history === null ? <p className={styles.detailSummary}>{t('canvas.lidar.loadingHistory')}</p> : (
        <ol className={styles.historyList}>
          {history.map((entry) => (
            <li key={entry.id} className={styles.historyEntry}>
              <span>{t(`canvas.lidar.operation.${entry.operation}`)}</span>
              <small>
                {entry.created_at} · {Number(entry.coverage_cells).toLocaleString()} {t('canvas.lidar.historyCells')}
                {entry.is_head ? ` · ${t('canvas.lidar.historyHead')}` : ''}
              </small>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={entry.is_head}
                onClick={() => onRestore(entry.id)}
              >{t('canvas.lidar.restoreVersion')}</button>
            </li>
          ))}
        </ol>
      )}
      {head === null && <p className={styles.detailSummary}>{t('canvas.lidar.empty')}</p>}
    </div>
  )
}

function DeleteDetail({ item, impact, analysisId, onCancel, onDelete }: {
  readonly item: LidarPresentationItem
  readonly impact: LidarDeleteImpact | null
  readonly analysisId: string | null
  onCancel(): void
  onDelete(): void
}) {
  const referencedIds = analysisId ? [analysisId] : [item.id, ...(impact?.analysis_ids ?? [])]
  const referenceCount = (currentDesign.value?.lidar?.entries ?? []).filter((entry) => referencedIds.includes(entry.id)).length
  if (!analysisId && impact === null) return <p className={styles.details}>{t('canvas.lidar.loadingImpact')}</p>
  return (
    <div className={styles.details}>
      <h4>{analysisId ? t('canvas.lidar.deleteAnalysisQuestion') : t('canvas.lidar.deleteLibraryQuestion')}</h4>
      <p>{analysisId ? t('canvas.lidar.deleteAnalysisImpact') : t('canvas.lidar.deleteImpactVisible', { analyses: impact?.analysis_count ?? 0, references: referenceCount })}</p>
      {!analysisId && <p className={styles.detailSummary}>{t('canvas.lidar.otherDesignCaveat')}</p>}
      <div className={styles.detailActions}>
        <button type="button" className={styles.secondaryButton} onClick={onCancel}>{t('canvas.lidar.review.cancel')}</button>
        <button type="button" className={styles.dangerButton} onClick={onDelete}>{analysisId ? t('canvas.lidar.deleteAnalysis') : t('canvas.lidar.deleteFromLibrary')}</button>
      </div>
    </div>
  )
}

function TerrainIcon() {
  return <svg className={styles.rowIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="m1 13 5-9 3 5 2-3 4 7ZM6 4l3 9" /></svg>
}

function AnalysisIcon() {
  return <svg className={styles.rowIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M2 12c3-7 5 2 8-6 1-2 2-2 4-2M2 8c3-5 5 2 8-3" /></svg>
}

function sourceState(item: LidarPresentationItem): string {
  if (item.state === 'unavailable') return stateLabel(item.state)
  const layer = lidarLibrary.value?.layers.find((candidate) => candidate.id === item.id)
  if (Number(layer?.coverage_cells ?? 0) === 0) return t('canvas.lidar.emptyState')
  return stateLabel(item.state)
}

function stateLabel(state: LidarPresentationItem['state']): string {
  return t(`canvas.lidar.state.${state}`)
}

function sourceFacts(resolution: number | null, cells: string, units: string): string {
  const parts = [`${t('canvas.lidar.units')}: ${units}`]
  if (resolution !== null) parts.push(`${resolution.toLocaleString()} m ${t('canvas.lidar.resolution')}`)
  const area = resolution === null ? null : Number(cells) * resolution * resolution
  if (area !== null) parts.push(`${formatArea(area)} ${t('canvas.lidar.coverage')}`)
  return parts.join(' · ')
}

function formatReviewArea(cells: string, resolution?: number): string {
  if (!resolution || !Number.isFinite(resolution)) return Number(cells).toLocaleString()
  return formatArea(Number(cells) * resolution * resolution)
}

function formatArea(squareMetres: number): string {
  return squareMetres >= 1_000_000
    ? `${(squareMetres / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} km²`
    : `${Math.round(squareMetres).toLocaleString()} m²`
}

function distanceToBoundsKm(lat: number, lon: number, bounds: [number, number, number, number]): number {
  const targetLon = Math.max(bounds[0], Math.min(bounds[2], lon))
  const targetLat = Math.max(bounds[1], Math.min(bounds[3], lat))
  const toRadians = (degrees: number): number => degrees * Math.PI / 180
  const dLat = toRadians(targetLat - lat)
  const dLon = toRadians(targetLon - lon)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat)) * Math.cos(toRadians(targetLat)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function boundsIntersect(
  first: [number, number, number, number],
  second: [number, number, number, number],
): boolean {
  return first[0] <= second[2]
    && first[2] >= second[0]
    && first[1] <= second[3]
    && first[3] >= second[1]
}
