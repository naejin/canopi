import { useEffect, useRef, useState } from 'preact/hooks'
import { currentDesign } from '../../../app/document-session/store'
import {
  lidarLibrary,
  lidarStatusMessage,
  openImportJob,
  readLidarPresentation,
  type LidarPresentationItem,
} from '../../../app/lidar/library-store'
import {
  analyseLayerAsSlope,
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
  setLidarEntryOpacity,
  setLidarEntryVisibility,
  movePresentationEntry,
  removePresentationEntry,
} from '../../../app/lidar/actions'
import {
  lidarMapViewBounds,
  viewDesignLocation,
  viewLidarCoverage,
} from '../../../app/lidar/camera-request'
import { t } from '../../../i18n'
import { beginInspection } from '../../../app/lidar/inspection'
import type {
  LidarDeleteImpact,
  LidarLayerCollection,
  LidarLayerHistoryPage,
} from '../../../ipc/lidar'
import { LayerVisibilityIcon } from '../../canvas/LayerPanel'
import layerStyles from '../../canvas/LayerPanel.module.css'
import { ActionMenu } from '../../shared/ActionMenu'
import { ButtonTooltip } from '../../shared/ButtonTooltip'
import styles from './lidar-layers-section.module.css'

type DetailMode = 'settings' | 'history' | 'delete'

/**
 * One view traversal the panel currently owns.
 *
 * An initial read starts one, a page continues it, and a selection change or a
 * library settlement replaces it with a new object. Only the object that is
 * still current may write view state, so a slow answer can neither replace a
 * newer selection's rows nor append a page from a composition the user has
 * already left.
 */
type ViewTraversal = {
  readonly layerId: string
  /** Head the first page reported; null until it arrives. */
  headId: string | null
  /** Requests issued for this traversal that have not settled. */
  inFlight: number
}

export function LidarLayersSection() {
  const library = lidarLibrary.value
  const trackedImport = openImportJob.value
  const items = readLidarPresentation(currentDesign.value, library)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<DetailMode>('settings')
  const [history, setHistory] = useState<LidarLayerHistoryPage | null>(null)
  const [collection, setCollection] = useState<LidarLayerCollection | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [deleteImpact, setDeleteImpact] = useState<LidarDeleteImpact | null>(null)
  const [analysisDeleteId, setAnalysisDeleteId] = useState<string | null>(null)
  const [showReturnToLocation, setShowReturnToLocation] = useState(false)
  /** The collection read a source list needs is in flight. */
  const [collectionLoading, setCollectionLoading] = useState(false)
  /** The history read the open History view needs is in flight. */
  const [historyLoading, setHistoryLoading] = useState(false)
  /** An edit the backend has not settled yet. */
  const [pending, setPending] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  /**
   * The collection and History traversals the panel currently owns.
   *
   * Each read captures the layer it belongs to and the head identity it first
   * reported; an answer whose traversal is no longer current is dropped, and a
   * page appends only into the traversal that produced it.
   */
  const collectionTraversal = useRef<ViewTraversal | null>(null)
  const historyTraversal = useRef<ViewTraversal | null>(null)
  /** The selection and mode the visible view shows, for settled callbacks. */
  const selectionRef = useRef<string | null>(null)
  const modeRef = useRef<DetailMode>('settings')
  /** One awaited edit owns the panel until it settles; unmount only detaches. */
  const editInFlight = useRef(false)
  const mounted = useRef(true)

  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null
  const selectedLayer = selected?.kind === 'Source'
    ? library?.layers.find((layer) => layer.id === selected.id)
    : null
  const selectedAnalysis = selected?.kind === 'Analysis'
    ? library?.analyses.find((analysis) => analysis.id === selected.id)
    : null
  const engineUnavailable = library !== null && !library.engine.available
  const selectedSourceId = selected?.kind === 'Source' ? selected.id : null
  /**
   * The summary and the open History must describe the same head. A
   * disagreement means one of them predates a publication, so numeric actions
   * stay unavailable until both have been re-read for the current head.
   */
  const headsConsistent = collection === null || history === null
    || collection.head_generation_id === history.head_generation_id

  // Completion callbacks run after the render that changed the view, so they
  // read the current selection from here rather than from a captured render.
  useEffect(() => {
    selectionRef.current = selectedSourceId
    modeRef.current = mode
  }, [selectedSourceId, mode])

  useEffect(() => () => {
    mounted.current = false
  }, [])

  const select = (id: string): void => {
    // A new selection supersedes every read the previous view still owns, so
    // its answers cannot land in the view that replaced it.
    collectionTraversal.current = null
    historyTraversal.current = null
    setCollectionLoading(false)
    setHistoryLoading(false)
    setSelectedId(id)
    setMode('settings')
    setHistory(null)
    setCollection(null)
    setConfirmRemove(null)
    setDeleteImpact(null)
    setAnalysisDeleteId(null)
    setEditError(null)
  }

  /**
   * Read the head the layer actually has.
   *
   * An initial read starts a new traversal and supersedes the previous
   * selection or head; a cursor continues the traversal it was requested from.
   * Each traversal settles its own loading state, so a completed read cannot
   * enable controls while the other required read is still in flight.
   */
  const loadCollection = (layerId: string, cursor: string | null = null): void => {
    const active = collectionTraversal.current
    let traversal: ViewTraversal
    if (cursor === null) {
      traversal = { layerId, headId: null, inFlight: 0 }
      collectionTraversal.current = traversal
    } else {
      // A page belongs to a settled traversal of this layer; without one there
      // is nothing to append to and the click is a no-op.
      if (active === null || active.layerId !== layerId || active.headId === null) return
      traversal = active
    }
    traversal.inFlight += 1
    setCollectionLoading(true)
    void fetchLayerCollection(layerId, cursor)
      .then((page) => {
        if (!mounted.current || collectionTraversal.current !== traversal) return
        // A page from another head would mix two compositions in one list.
        if (cursor !== null && page.head_generation_id !== traversal.headId) return
        traversal.headId = page.head_generation_id
        setCollection((current) =>
          cursor !== null && current !== null && current.head_generation_id === page.head_generation_id
            ? { ...page, sources: [...current.sources, ...page.sources] }
            : page,
        )
      })
      .catch((error) => {
        if (!mounted.current || collectionTraversal.current !== traversal) return
        lidarStatusMessage.value = error instanceof Error ? error.message : String(error)
      })
      .finally(() => {
        traversal.inFlight -= 1
        if (mounted.current && collectionTraversal.current === traversal && traversal.inFlight === 0) {
          setCollectionLoading(false)
        }
      })
  }

  /** Read one history page, keeping the traversal's captured head. */
  const loadHistory = (layerId: string, cursor: string | null = null): void => {
    const active = historyTraversal.current
    let traversal: ViewTraversal
    if (cursor === null) {
      traversal = { layerId, headId: null, inFlight: 0 }
      historyTraversal.current = traversal
    } else {
      if (active === null || active.layerId !== layerId || active.headId === null) return
      traversal = active
    }
    traversal.inFlight += 1
    setHistoryLoading(true)
    void fetchLayerHistory(layerId, cursor)
      .then((page) => {
        if (!mounted.current || historyTraversal.current !== traversal) return
        if (cursor !== null && page.head_generation_id !== traversal.headId) return
        traversal.headId = page.head_generation_id
        setHistory((current) =>
          cursor !== null && current !== null && current.head_generation_id === page.head_generation_id
            ? { ...page, versions: [...current.versions, ...page.versions] }
            : page,
        )
      })
      .catch((error) => {
        if (!mounted.current || historyTraversal.current !== traversal) return
        lidarStatusMessage.value = error instanceof Error ? error.message : String(error)
      })
      .finally(() => {
        traversal.inFlight -= 1
        if (mounted.current && historyTraversal.current === traversal && traversal.inFlight === 0) {
          setHistoryLoading(false)
        }
      })
  }

  // The priority list and the open history are library data, so both are
  // re-read whenever the library snapshot settles: a reorder, remove, Undo, a
  // restore or a completed import all publish a new head, and the panel must
  // show that head rather than the one it happened to load first. History also
  // needs the summary, because Undo's availability and its target live there.
  useEffect(() => {
    if (selectedSourceId === null) return
    loadCollection(selectedSourceId)
    if (mode === 'history') loadHistory(selectedSourceId)
    // `library` is the settlement signal, not a value this effect reads.
  }, [mode, selectedSourceId, library])

  // Two settled pages that disagree describe different heads: re-read both once
  // for the pair, and leave numeric actions unavailable until they agree.
  const reloadedMismatch = useRef<string | null>(null)
  useEffect(() => {
    if (mode !== 'history' || collection === null || history === null) return
    if (collection.head_generation_id === history.head_generation_id) return
    if (collectionLoading || historyLoading || selectedSourceId === null) return
    const key = `${collection.head_generation_id}|${history.head_generation_id}`
    if (reloadedMismatch.current === key) return
    reloadedMismatch.current = key
    loadCollection(selectedSourceId)
    loadHistory(selectedSourceId)
  }, [mode, collection, history, collectionLoading, historyLoading])

  /**
   * Run one awaited edit.
   *
   * The backend resolves only after the edit has settled, so a failure leaves
   * its message on screen and a success re-reads the head the panel now has.
   * The edit owns the panel's pending state until it settles even when the view
   * moves on, while its view updates stay fenced to the selection that asked
   * for them. Controls stay disabled for the whole round trip, so a second edit
   * can never be sent without the snapshot the user actually saw.
   */
  const runEdit = (layerId: string, work: () => Promise<unknown>): void => {
    if (editInFlight.current) return
    editInFlight.current = true
    setPending(true)
    setEditError(null)
    const refreshVisible = (): void => {
      // The edit keeps its own course after teardown; only view work stops.
      if (!mounted.current || selectionRef.current !== layerId) return
      loadCollection(layerId)
      if (modeRef.current === 'history') loadHistory(layerId)
    }
    void work()
      .then(refreshVisible)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        // The named failure is always reported; its inline copy belongs to the
        // view that submitted the edit.
        lidarStatusMessage.value = message
        if (selectionRef.current === layerId && mounted.current) setEditError(message)
        // A refusal means the head moved: re-read it so the next attempt sends
        // the snapshot the user is actually looking at.
        refreshVisible()
      })
      .finally(() => {
        editInFlight.current = false
        if (mounted.current) setPending(false)
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
    // The effect above reads both pages for the new selection, so the view is
    // primed from the head the library reports rather than from a stale one.
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
        <h3>{t('canvas.lidar.section')} <span>{items.length}</span></h3>
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
      {/*
        A running import is progress, not a decision to return to: the one-step
        route never waits for review, so this reports the phase and percentage
        in place instead of opening a second screen.
      */}
      {trackedImport !== null && (
        <p className={styles.pendingReview} role="status">
          {trackedImport.progress
            ? `${t(`canvas.lidar.progressPhase.${trackedImport.progress.phase}`)} · ${trackedImport.progress.percent}%`
            : t(`canvas.lidar.jobState.${trackedImport.state}`)}
        </p>
      )}
      {/*
        One flat geographic presentation list in the Design\'s own saved order.
        A source and its results are peers here, not parent and child: an eye
        controls its own entry\'s visibility, so hiding a source never hides an
        independently displayed result, and a result never sits behind a nested
        disclosure that a source collapse could take away.
      */}
      <div className={styles.layerList} role="list">
        {items.map((item, index) => {
          const layer = item.kind === 'Source'
            ? library?.layers.find((candidate) => candidate.id === item.id)
            : undefined
          // A result states the unit it was computed in: labelling every row
          // "slope (degrees)" misreports a percent result.
          const metadata = item.kind === 'Source'
            ? `${t(`canvas.lidar.kind.${layer?.measurement_kind ?? item.detail}`)} · ${sourceState(item)}`
            : `${t(item.slopeUnit === 'Percent'
                ? 'canvas.lidar.slopePercent'
                : 'canvas.lidar.slopeDegrees')} · ${stateLabel(item.state)}`
          return (
            <div
              key={item.id}
              className={styles.layerRow}
              data-selected={selected?.id === item.id}
              data-hidden={!item.visible}
              data-kind={item.kind}
              role="listitem"
            >
              <span className={styles.kindBadge} data-kind={item.kind}>
                {item.kind === 'Source' ? <TerrainIcon /> : <AnalysisIcon />}
              </span>
              <VisibilityButton item={item} />
              <button type="button" className={styles.layerIdentity} onClick={() => select(item.id)}>
                <span className={styles.identityText}>
                  <span className={styles.name}>{item.name}</span>
                  <span className={styles.metadata}>{metadata}</span>
                </span>
              </button>
              <MoveControls item={item} position={index} total={items.length} />
              {/*
                Remove from Design is offered for every entry, unavailable
                references included: it is a document edit that keeps the
                library intact and is undoable with the Design's own history, so
                it is never a reason to hide it behind a library operation.
              */}
              <ActionMenu label={t('canvas.lidar.actions')} items={[
                ...(item.state === 'unavailable'
                  ? []
                  : [{
                      label: t('canvas.rasterSample.title'),
                      run: () => beginInspection({ kind: item.kind, id: item.id, name: item.name }),
                    }]),
                ...(item.kind === 'Source' && item.state !== 'unavailable'
                  ? [{ label: t('canvas.lidar.history'), run: () => openHistory(item) }]
                  : []),
                {
                  label: t('canvas.lidar.removeFromDesign'),
                  run: () => removePresentationEntry(item.id),
                },
                ...(item.state !== 'unavailable'
                  ? [item.kind === 'Source'
                      ? {
                          label: t('canvas.lidar.deleteFromLibrary'),
                          danger: true,
                          run: () => openLayerDelete(item),
                        }
                      : {
                          label: t('canvas.lidar.deleteAnalysis'),
                          danger: true,
                          run: () => {
                            select(item.id)
                            setAnalysisDeleteId(item.id)
                            setMode('delete')
                          },
                        }]
                  : []),
              ]} />
            </div>
          )
        })}
        {items.length === 0 && <p className={styles.emptyHint}>{t('canvas.lidar.empty')}</p>}
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
              pending={pending}
              collectionLoading={collectionLoading}
              historyLoading={historyLoading}
              metadataConsistent={headsConsistent}
              error={editError}
              onBack={() => setMode('settings')}
              onLoadMore={() => {
                const cursor = history?.next_cursor ?? null
                if (cursor !== null) loadHistory(selected.id, cursor)
              }}
              onUndo={() =>
                runEdit(selected.id, () =>
                  undoLayerChange(
                    selected.id,
                    collection?.head_generation_id ?? history?.head_generation_id ?? null,
                  ),
                )
              }
              onRestore={(versionId) =>
                runEdit(selected.id, () =>
                  restoreLayerVersion(
                    selected.id,
                    versionId,
                    collection?.head_generation_id ?? history?.head_generation_id ?? null,
                  ),
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
                  pending={pending}
                  loading={collectionLoading}
                  error={editError}
                  onConfirmRemove={setConfirmRemove}
                  onLoadMore={() => {
                    const cursor = collection?.next_member_cursor ?? null
                    if (cursor !== null) loadCollection(selected.id, cursor)
                  }}
                  onMove={(memberId, towardsTop) =>
                    runEdit(selected.id, () =>
                      moveLayerSource(
                        selected.id,
                        memberId,
                        towardsTop,
                        collection?.head_generation_id ?? null,
                      ),
                    )
                  }
                  onRemove={(memberId) => {
                    setConfirmRemove(null)
                    runEdit(selected.id, () =>
                      removeLayerSource(
                        selected.id,
                        memberId,
                        collection?.head_generation_id ?? null,
                      ),
                    )
                  }}
                />
              )}
              <OpacityControl item={selected} />
              {selected.kind === 'Source' && selectedLayer && (
                <SourceActions
                  item={selected}
                  coverageCells={
                    selectedLayer.coverage_cells === null
                      ? null
                      : Number(selectedLayer.coverage_cells)
                  }
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


/**
 * Keyboard-accessible reorder controls for one presentation entry.
 *
 * Order is the Design's own display order, so this is a Design Edit and travels
 * through document history. It is display order only: reordering presentation
 * never reorders the sources inside a Data Layer, which is the library's own
 * numeric priority.
 */
function MoveControls({
  item,
  position,
  total,
}: {
  readonly item: LidarPresentationItem
  readonly position: number
  readonly total: number
}) {
  return (
    <span className={styles.moveControls}>
      <button
        type="button"
        className={styles.moveButton}
        aria-label={`${t('canvas.lidar.moveUp')}: ${item.name}`}
        disabled={position === 0}
        onClick={() => movePresentationEntry(item.id, 'up')}
      >
        <span aria-hidden="true">↑</span>
      </button>
      <button
        type="button"
        className={styles.moveButton}
        aria-label={`${t('canvas.lidar.moveDown')}: ${item.name}`}
        disabled={position === total - 1}
        onClick={() => movePresentationEntry(item.id, 'down')}
      >
        <span aria-hidden="true">↓</span>
      </button>
    </span>
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
  /** `null` when the exact coverage is not known; unknown is not empty. */
  readonly coverageCells: number | null
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
      {!location && coverageCells !== 0 && <p className={styles.notice}>{t('canvas.lidar.locationRequired')}</p>}
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
        {item.detail === 'GroundElevation' && coverageCells !== 0 && <button type="button" className={styles.secondaryButton} disabled={engineUnavailable} onClick={() => void analyseLayerAsSlope(item.id)}>{t('canvas.lidar.createSlope')}</button>}
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
function SourcePriorityList({ collection, confirmRemove, pending, loading, error, onConfirmRemove, onLoadMore, onMove, onRemove }: {
  readonly collection: LidarLayerCollection | null
  readonly confirmRemove: string | null
  readonly pending: boolean
  readonly loading: boolean
  readonly error: string | null
  onConfirmRemove(memberId: string | null): void
  onLoadMore(): void
  onMove(memberId: string, towardsTop: boolean): void
  onRemove(memberId: string): void
}) {
  if (collection === null) {
    return <p className={styles.detailSummary}>{t('canvas.lidar.loadingSources')}</p>
  }
  // Controls stay disabled while a read is in flight or an edit is pending, so
  // every request carries the head the user actually saw.
  const busy = pending || loading
  return (
    <div className={styles.sourceList}>
      <h4>{t('canvas.lidar.sources')} <span>{collection.member_count}</span></h4>
      <p className={styles.detailSummary}>{t('canvas.lidar.sourceOrderHint')}</p>
      {error !== null && <p className={styles.errorMessage} role="alert">{error}</p>}
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
                    : `${coverageLabel(source.coverage_cells)} ${t('canvas.lidar.historyCells')}`}
                </small>
              </span>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t('canvas.lidar.moveUp')}
                disabled={busy || index === 0}
                onClick={() => onMove(source.member_id, true)}
              >↑</button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t('canvas.lidar.moveDown')}
                disabled={busy || (index === collection.sources.length - 1 && collection.next_member_cursor === null)}
                onClick={() => onMove(source.member_id, false)}
              >↓</button>
              {confirmRemove === source.member_id ? (
                <span className={styles.confirmRow}>
                  <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => onRemove(source.member_id)}>
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
                  disabled={busy}
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
      {collection.next_member_cursor !== null && (
        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={onLoadMore}>
          {t('canvas.lidar.loadMoreSources')}
        </button>
      )}
      <p className={styles.detailSummary}>{t('canvas.lidar.libraryOrderNote')}</p>
    </div>
  )
}

/**
 * Published versions of the layer, newest first.
 *
 * Each entry carries what actually happened, when it was published, its own
 * position in the layer's publication order and its occurrence count, so two
 * consecutive imports never read alike and a version migrated from an older
 * catalogue is named neutrally instead of being guessed. Restoring publishes a
 * new head and deletes nothing.
 */
function HistoryDetail({ history, collection, pending, collectionLoading, historyLoading, metadataConsistent, error, onBack, onLoadMore, onUndo, onRestore }: {
  readonly history: LidarLayerHistoryPage | null
  readonly collection: LidarLayerCollection | null
  readonly pending: boolean
  readonly collectionLoading: boolean
  readonly historyLoading: boolean
  /** The summary and History describe the same head. */
  readonly metadataConsistent: boolean
  readonly error: string | null
  onBack(): void
  onLoadMore(): void
  onUndo(): void
  onRestore(versionId: string): void
}) {
  // Undo's availability and target come from the summary, Restore's from the
  // version page, and both send the head the user saw: an action waits until
  // every page it reads has settled for the same head.
  const busy = pending || collectionLoading || historyLoading || !metadataConsistent
  const versions = history?.versions ?? null
  return (
    <div className={styles.details}>
      <button type="button" className={styles.textButton} onClick={onBack}>‹ {t('canvas.lidar.backToSettings')}</button>
      <h4>{t('canvas.lidar.history')}</h4>
      {error !== null && <p className={styles.errorMessage} role="alert">{error}</p>}
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={busy || !(collection?.undo_available ?? false)}
        onClick={onUndo}
      >
        {t('canvas.lidar.undoLastChange')}
      </button>
      {!collection?.undo_available && collection?.head_generation_id != null && (
        <p className={styles.detailSummary}>{t('canvas.lidar.undoExhausted')}</p>
      )}
      {versions === null ? <p className={styles.detailSummary}>{t('canvas.lidar.loadingHistory')}</p> : (
        <ol className={styles.historyList}>
          {versions.map((entry) => (
            <li key={entry.id} className={styles.historyEntry}>
              <span>
                {entry.operation === null
                  ? t('canvas.lidar.operation.previousVersion')
                  : t(`canvas.lidar.operation.${entry.operation}`)}
                <span className={styles.versionCue}>{t('canvas.lidar.versionCue', { number: entry.sequence })}</span>
              </span>
              <small>
                {entry.created_at} · {entry.source_count} {t('canvas.lidar.historySources')} ·{' '}
                {coverageLabel(entry.coverage_cells)} {t('canvas.lidar.historyCells')}
                {entry.is_head ? ` · ${t('canvas.lidar.historyHead')}` : ''}
              </small>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={busy || !entry.restorable}
                onClick={() => onRestore(entry.id)}
              >{t('canvas.lidar.restoreVersion')}</button>
            </li>
          ))}
        </ol>
      )}
      {history?.next_cursor != null && (
        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={onLoadMore}>
          {t('canvas.lidar.loadMoreVersions')}
        </button>
      )}
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
  // A count of zero is a measured emptiness; an unknown count is not emptiness,
  // so it keeps the layer's own state rather than claiming there is nothing.
  if (layer?.coverage_cells === '0') return t('canvas.lidar.emptyState')
  return stateLabel(item.state)
}

function stateLabel(state: LidarPresentationItem['state']): string {
  return t(`canvas.lidar.state.${state}`)
}

function sourceFacts(resolution: number | null, cells: string | null, units: string): string {
  const parts = [`${t('canvas.lidar.units')}: ${units}`]
  if (resolution !== null) parts.push(`${resolution.toLocaleString()} m ${t('canvas.lidar.resolution')}`)
  // Unknown coverage is reported as not calculated rather than as zero area:
  // an area of 0 ha would be a measurement this generation never took.
  if (cells === null) {
    parts.push(`${t('canvas.lidar.notCalculated')} ${t('canvas.lidar.coverage')}`)
  } else if (resolution !== null) {
    parts.push(`${formatArea(Number(cells) * resolution * resolution)} ${t('canvas.lidar.coverage')}`)
  }
  return parts.join(' · ')
}

/** One coverage figure, or the honest label for a count that was never taken. */
function coverageLabel(cells: string | null): string {
  return cells === null ? t('canvas.lidar.notCalculated') : Number(cells).toLocaleString()
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
