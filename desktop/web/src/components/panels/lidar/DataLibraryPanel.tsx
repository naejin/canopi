import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { currentDesign } from '../../../app/document-session/store'
import {
  addToDesign,
  calculateSlope,
  cancelAnalysisJob,
  cancelLibraryImport,
  chooseImportFiles,
  deleteLibraryItem,
  dismissLibraryImport,
  fetchDeleteImpact,
  fetchItemSources,
  importLibraryItem,
  renameLibraryItem,
  retryFailedCalculation,
  retryLibraryImport,
  runningAnalysisJobId,
} from '../../../app/lidar/actions'
import {
  filterLibraryItems,
  libraryItems,
  slopeIneligibility,
  suggestedItemName,
  type LibraryItem,
  type LibraryTypeFilter,
  type SlopeIneligibility,
} from '../../../app/lidar/library-items'
import { installLidarLibraryObserver, lidarLibrary, lidarStatusMessage } from '../../../app/lidar/library-store'
import { libraryCalculateRequest, libraryFocusRequest } from '../../../app/lidar/library-navigation'
import type {
  LidarAnalysisMethod,
  LidarDeleteImpact,
  LidarMeasurementKind,
  LidarSlopeUnit,
} from '../../../generated/contracts'
import { t } from '../../../i18n'
import { ActionMenu } from '../../shared/ActionMenu'
import { DockPanelHeader } from '../../shared/DockPanelHeader'
import { SurfaceSearch } from '../../shared/SurfaceSearch'
import { LibraryPreview, usePreviewClient } from './LibraryPreview'
import styles from './data-library.module.css'

type View =
  | { readonly kind: 'list' }
  | { readonly kind: 'import'; readonly paths: readonly string[] }
  | { readonly kind: 'details' | 'rename' | 'delete'; readonly id: string }
  | { readonly kind: 'calculate'; readonly id: string; readonly attach: boolean }

const MEASUREMENTS: readonly LidarMeasurementKind[] = ['GroundElevation', 'SurfaceElevation', 'AboveGroundHeight', 'OtherContinuous']

/**
 * The Data Library: reusable terrain data shared by every Design.
 *
 * Import creates library items; Add to Design is the only attachment step.
 * Search, filter, scroll and detail navigation are session view state and
 * never enter a Design. Library work keeps running when the dock closes or the
 * Design changes; only an explicit Cancel stops it.
 */
export function DataLibraryPanel() {
  useEffect(() => installLidarLibraryObserver(), [])
  const client = usePreviewClient()
  const snapshot = lidarLibrary.value
  const items = useMemo(() => libraryItems(snapshot, t('canvas.lidar.library.typeSlope')), [snapshot])
  const references = currentDesign.value?.lidar?.entries ?? []
  const [view, setView] = useState<View>({ kind: 'list' })
  const [query, setQuery] = useState('')
  const [type, setType] = useState<LibraryTypeFilter>('all')
  const [relatedTo, setRelatedTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const savedScroll = useRef(0)
  const restoreFocusId = useRef<string | null>(null)
  const restoringList = useRef(false)

  const visible = filterLibraryItems(items, query, type, relatedTo)
  const item = 'id' in view ? items.find((candidate) => candidate.id === view.id) ?? null : null
  const isAdded = (row: LibraryItem) => references.some((entry) => entry.id === row.id)
  const slopeEngine = snapshot?.slope_engine

  // Another surface (Layers) can ask to show one item's details.
  useEffect(() => {
    const request = libraryFocusRequest.value
    if (!request) return
    libraryFocusRequest.value = null
    open({ kind: 'details', id: request })
  }, [libraryFocusRequest.value])

  // Layers can ask to calculate slope; that result joins the asking Design.
  useEffect(() => {
    const request = libraryCalculateRequest.value
    if (!request) return
    libraryCalculateRequest.value = null
    open({ kind: 'calculate', id: request, attach: true })
  }, [libraryCalculateRequest.value])

  useLayoutEffect(() => {
    if (view.kind === 'list' && restoringList.current) {
      restoringList.current = false
      if (scroll.current) scroll.current.scrollTop = savedScroll.current
      const target = restoreFocusId.current
        ? document.getElementById(`library-item-${restoreFocusId.current}`)
        : null
      ;(target ?? scroll.current?.querySelector<HTMLElement>('input'))?.focus({ preventScroll: true })
    } else if (view.kind !== 'list') {
      scroll.current?.querySelector<HTMLElement>('[data-autofocus="true"], input, h3')?.focus()
    }
  }, [view])

  const open = (next: View) => {
    if (view.kind === 'list') savedScroll.current = scroll.current?.scrollTop ?? 0
    if ('id' in next) restoreFocusId.current = next.id
    setError(null)
    setView(next)
  }
  const back = () => {
    restoringList.current = true
    setError(null)
    setView({ kind: 'list' })
  }
  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      after?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const beginImport = () => void run(async () => {
    const paths = await chooseImportFiles(t('canvas.lidar.library.chooseFiles'))
    // Cancelling the chooser creates nothing and leaves the list as it was.
    if (paths) open({ kind: 'import', paths })
  })

  const addButton = (row: LibraryItem) => {
    const added = isAdded(row)
    return (
      <button
        type="button"
        className={styles.add}
        disabled={row.status !== 'ready' || added || !currentDesign.value}
        aria-label={added
          ? t('canvas.lidar.library.addedAria', { name: row.name })
          : t('canvas.lidar.library.addAria', { name: row.name })}
        onClick={() => addToDesign(row.kind, row.id)}
      >
        {added ? t('canvas.lidar.library.added') : t('canvas.lidar.library.addToDesign')}
      </button>
    )
  }
  const menu = (row: LibraryItem) => (
    <ActionMenu label={t('canvas.lidar.library.actionsFor', { name: row.name })} items={[
      ...(row.kind === 'Source' && row.status === 'ready'
        ? [{ label: t('canvas.lidar.library.calculateSlope'), run: () => open({ kind: 'calculate', id: row.id, attach: false }) }]
        : []),
      ...(row.status === 'ready' ? [{ label: t('canvas.lidar.library.rename'), run: () => open({ kind: 'rename', id: row.id }) }] : []),
      ...(row.status === 'ready' || row.kind === 'Analysis'
        ? [{ label: t('canvas.lidar.library.deleteFromLibrary'), danger: true, run: () => open({ kind: 'delete', id: row.id }) }]
        : []),
    ]} />
  )
  const operation = (row: LibraryItem) => {
    if (row.status === 'preparing' && row.importJob) {
      const progress = row.importJob.progress
      return (
        <div className={styles.job}>
          <progress
            aria-label={t('canvas.lidar.library.progressAria', { name: row.name })}
            max={100}
            value={progress?.percent}
          />
          <button type="button" onClick={() => void run(() => cancelLibraryImport(row.importJob!.job_id))}>
            {t('canvas.lidar.library.cancel')}
          </button>
        </div>
      )
    }
    if (row.status === 'preparing' && row.kind === 'Analysis') {
      const running = runningAnalysisJobId(row.id) !== null
      return (
        <div className={styles.job}>
          <span role="status">{t('canvas.lidar.library.calculating')}</span>
          {running && (
            <button type="button" onClick={() => void run(() => cancelAnalysisJob(row.id))}>
              {t('canvas.lidar.library.cancel')}
            </button>
          )}
        </div>
      )
    }
    if (row.status === 'failed' && row.kind === 'Source') {
      return (
        <div className={styles.job}>
          <span role="status">{row.message || t('canvas.lidar.library.importFailed')}</span>
          <button type="button" disabled={busy} onClick={() => void run(() => retryLibraryImport(row.id))}>
            {t('canvas.lidar.library.retry')}
          </button>
          <button type="button" disabled={busy} onClick={() => void run(() => dismissLibraryImport(row.id))}>
            {t('canvas.lidar.library.dismiss')}
          </button>
        </div>
      )
    }
    if (row.status === 'failed' && row.kind === 'Analysis' && row.inputGenerationId === null) {
      return (
        <div className={styles.job}>
          <span role="status">{row.message || t('canvas.lidar.library.calculationFailed')}</span>
        </div>
      )
    }
    return null
  }

  return (
    <div className={styles.panel}>
      <DockPanelHeader
        title={t('canvas.lidar.library.title')}
        count={items.length}
        actions={view.kind === 'list'
          ? <button type="button" className={styles.primary} disabled={busy} onClick={beginImport}>{t('canvas.lidar.library.import')}</button>
          : undefined}
      />
      <div className={styles.scroll} ref={scroll}>
        {(error || lidarStatusMessage.value) && view.kind === 'list' && (
          <p className={styles.error} role="alert">{error ?? lidarStatusMessage.value}</p>
        )}
        {view.kind === 'list' && <>
          <div className={styles.filters}>
            <SurfaceSearch value={query} onChange={(value) => { setQuery(value); setRelatedTo(null) }} label={t('canvas.lidar.library.searchLabel')} />
            <label>
              {t('canvas.lidar.library.typeLabel')}
              <select value={type} aria-label={t('canvas.lidar.library.typeLabel')} onChange={(event) => { setType(event.currentTarget.value as LibraryTypeFilter); setRelatedTo(null) }}>
                <option value="all">{t('canvas.lidar.library.typeAll')}</option>
                <option value="sources">{t('canvas.lidar.library.typeSources')}</option>
                <option value="slope">{t('canvas.lidar.library.typeSlope')}</option>
              </select>
            </label>
            {relatedTo !== null && (
              <button type="button" className={styles.link} onClick={() => setRelatedTo(null)}>
                {t('canvas.lidar.library.showAll')}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className={styles.empty}>
              <h3>{t('canvas.lidar.library.emptyTitle')}</h3>
              <p>{t('canvas.lidar.library.emptyBody')}</p>
              <button type="button" onClick={beginImport}>{t('canvas.lidar.library.emptyAction')}</button>
            </div>
          ) : (
            <ul className={styles.list}>
              {visible.map((row) => (
                <li className={styles.item} key={`${row.kind}-${row.id}`}>
                  <div className={styles.itemMain}>
                    <button
                      type="button"
                      id={`library-item-${row.id}`}
                      className={styles.identity}
                      onClick={() => open({ kind: 'details', id: row.id })}
                    >
                      <LibraryPreview item={row} client={client} width={104} height={84} />
                      <span>
                        <strong>{row.name}</strong>
                        <small>{summary(row)}</small>
                        {row.status !== 'ready' && (
                          <small data-error={row.status === 'failed'}>{statusLabel(row)}</small>
                        )}
                      </span>
                    </button>
                    {menu(row)}
                  </div>
                  {row.status === 'ready' && <div className={styles.rowActions}>{addButton(row)}</div>}
                  {operation(row)}
                </li>
              ))}
            </ul>
          )}
          {items.length > 0 && visible.length === 0 && (
            <div className={styles.empty}>
              <p>{t('canvas.lidar.library.noMatch')}</p>
              <button type="button" onClick={() => { setQuery(''); setType('all'); setRelatedTo(null) }}>
                {t('canvas.lidar.library.clearFilters')}
              </button>
            </div>
          )}
          <p className={styles.hint}>{t('canvas.lidar.library.sharedHint')}</p>
        </>}

        {view.kind !== 'list' && (
          <button type="button" className={styles.back} onClick={back}>← {t('canvas.lidar.library.back')}</button>
        )}
        {view.kind === 'import' && (
          <ImportForm
            paths={view.paths}
            busy={busy}
            error={error}
            onCancel={back}
            onSubmit={(name, kind, unit) => void run(
              () => importLibraryItem([...view.paths], name, kind, unit),
              () => { restoreFocusId.current = null; back() },
            )}
          />
        )}
        {view.kind === 'details' && item && (
          <ItemDetails
            item={item}
            client={client}
            items={items}
            addButton={addButton(item)}
            menu={menu(item)}
            operation={operation(item)}
            busy={busy}
            onRetryCalculation={() => item.inputGenerationId === null
              ? undefined
              : void run(() => retryFailedCalculation(item.id, item.inputGenerationId!))}
            onOpen={(id) => open({ kind: 'details', id })}
            onCalculate={() => open({ kind: 'calculate', id: item.id, attach: false })}
          />
        )}
        {view.kind === 'calculate' && item && (
          <CalculateSlopeForm
            item={item}
            reason={slopeIneligibility(item, slopeEngine?.available ?? false)}
            engineDetail={slopeEngine?.detail ?? null}
            attach={view.attach}
            busy={busy}
            error={error}
            onCancel={back}
            onSubmit={(unit, name) => void run(
              () => calculateSlope(item.id, unit, name, view.attach),
              () => { restoreFocusId.current = null; back() },
            )}
          />
        )}
        {view.kind === 'details' && !item && <p className={styles.muted}>{t('canvas.lidar.library.itemGone')}</p>}
        {view.kind === 'rename' && item && (
          <RenameForm item={item} busy={busy} error={error} onCancel={back}
            onSubmit={(name) => void run(() => renameLibraryItem(item.kind, item.id, name), back)} />
        )}
        {view.kind === 'delete' && item && (
          <DeleteConfirmation
            item={item}
            inCurrentDesign={isAdded(item)}
            busy={busy}
            error={error}
            onKeep={back}
            onShowResults={() => { setRelatedTo(item.id); setQuery(''); setType('all'); back() }}
            onDelete={() => void run(() => deleteLibraryItem(item.kind, item.id), () => { restoreFocusId.current = null; back() })}
          />
        )}
      </div>
    </div>
  )
}

function summary(row: LibraryItem): string {
  const type = row.kind === 'Analysis'
    ? t('canvas.lidar.library.typeSlope')
    : t(`canvas.lidar.library.measurement.${row.type}`)
  if (row.kind === 'Analysis') return `${type} · ${row.units}`
  const resolution = row.resolutionM !== null ? ` · ${formatMetres(row.resolutionM)}` : ''
  return `${type}${resolution}`
}

function statusLabel(row: LibraryItem): string {
  if (row.status === 'preparing') {
    const phase = row.importJob?.progress?.phase
    return phase ? t(`canvas.lidar.progressPhase.${phase}`) : t('canvas.lidar.library.preparing')
  }
  // A calculation reports cancellation through its detail, an import through its job.
  if (row.importJob?.state === 'Cancelled' || (row.kind === 'Analysis' && row.message === 'cancelled')) {
    return t('canvas.lidar.library.cancelled')
  }
  return row.kind === 'Analysis' ? t('canvas.lidar.library.calculationFailed') : t('canvas.lidar.library.importFailed')
}

function formatMetres(value: number): string {
  return `${value >= 10 ? value.toFixed(0) : value >= 1 ? value.toFixed(1) : value.toFixed(2)} m`
}

function ImportForm({ paths, busy, error, onCancel, onSubmit }: {
  paths: readonly string[]
  busy: boolean
  error: string | null
  onCancel(): void
  onSubmit(name: string, kind: LidarMeasurementKind, unit: { label: string | null; unknown: boolean }): void
}) {
  const [name, setName] = useState(() => suggestedItemName(paths))
  const [kind, setKind] = useState<LidarMeasurementKind | ''>('')
  const [unitLabel, setUnitLabel] = useState('')
  const [unitUnknown, setUnitUnknown] = useState(false)
  const unitReady = kind !== 'OtherContinuous' || unitUnknown || unitLabel.trim() !== ''
  return (
    <form className={styles.form} onSubmit={(event) => {
      event.preventDefault()
      if (!kind || !name.trim() || !unitReady || busy) return
      onSubmit(name.trim(), kind, kind === 'OtherContinuous'
        ? { label: unitUnknown ? null : unitLabel.trim(), unknown: unitUnknown }
        : { label: null, unknown: false })
    }}>
      <h3 tabIndex={-1} data-autofocus="true">{t('canvas.lidar.library.importTitle')}</h3>
      <label>
        {t('canvas.lidar.library.name')}
        <input required value={name} onInput={(event) => setName(event.currentTarget.value)} />
      </label>
      <label>
        {t('canvas.lidar.library.measurementLabel')}
        <select required value={kind} onChange={(event) => setKind(event.currentTarget.value as LidarMeasurementKind)}>
          <option value="" disabled>{t('canvas.lidar.library.chooseMeasurement')}</option>
          {MEASUREMENTS.map((value) => (
            <option key={value} value={value}>{t(`canvas.lidar.library.measurement.${value}`)}</option>
          ))}
        </select>
      </label>
      {kind === 'OtherContinuous' && (
        <fieldset className={styles.unit}>
          <label>
            {t('canvas.lidar.library.unit')}
            <input value={unitLabel} disabled={unitUnknown} onInput={(event) => setUnitLabel(event.currentTarget.value)} />
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={unitUnknown} onChange={(event) => setUnitUnknown(event.currentTarget.checked)} />
            {t('canvas.lidar.library.unitUnknown')}
          </label>
        </fieldset>
      )}
      <p>{t('canvas.lidar.library.files', { count: paths.length })}</p>
      {paths.length > 1 && <p className={styles.muted}>{t('canvas.lidar.library.priorityNote')}</p>}
      <p className={styles.muted}>{t('canvas.lidar.library.libraryOnlyNote')}</p>
      <details>
        <summary>{t('canvas.lidar.library.selectedFiles')}</summary>
        <ol className={styles.files}>
          {paths.map((path) => <li key={path} className={styles.filename}>{path.split(/[\\/]/).pop()}</li>)}
        </ol>
      </details>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.formActions}>
        <button type="button" onClick={onCancel}>{t('canvas.lidar.library.cancel')}</button>
        <button type="submit" className={styles.primary} disabled={busy || !kind || !name.trim() || !unitReady}>
          {t('canvas.lidar.library.importFiles', { count: paths.length })}
        </button>
      </div>
    </form>
  )
}

function methodLabel(method: LidarAnalysisMethod | null): string {
  if (method === 'GeolibreProjectedSlopeV1') return t('canvas.lidar.library.methodGeolibre')
  return t('canvas.lidar.library.methodUnknown')
}

function ItemDetails({ item, client, items, addButton, menu, operation, busy, onRetryCalculation, onOpen, onCalculate }: {
  item: LibraryItem
  client: ReturnType<typeof usePreviewClient>
  items: readonly LibraryItem[]
  addButton: preact.ComponentChildren
  menu: preact.ComponentChildren
  operation: preact.ComponentChildren
  busy: boolean
  onRetryCalculation(): void
  onOpen(id: string): void
  onCalculate(): void
}) {
  const [files, setFiles] = useState<string[] | null>(null)
  useEffect(() => {
    setFiles(null)
    if (item.kind !== 'Source' || item.status !== 'ready') return
    let current = true
    void fetchItemSources(item.id)
      .then((page) => { if (current) setFiles(page.sources.map((source) => source.filename)) })
      .catch(() => { if (current) setFiles([]) })
    return () => { current = false }
  }, [item.id, item.status])
  const input = item.sourceLayerId ? items.find((candidate) => candidate.id === item.sourceLayerId) : null
  return (
    <div className={styles.form}>
      <div className={styles.detailTitle}>
        <h3 tabIndex={-1} data-autofocus="true">{item.name}</h3>
        {menu}
      </div>
      <div className={styles.previewFrame}>
        <LibraryPreview item={item} client={client} width={640} height={328} large />
      </div>
      <dl className={styles.facts}>
        <dt>{t('canvas.lidar.library.factType')}</dt>
        <dd>{item.kind === 'Analysis' ? t('canvas.lidar.library.typeSlope') : t(`canvas.lidar.library.measurement.${item.type}`)}</dd>
        <dt>{t('canvas.lidar.library.factUnits')}</dt>
        <dd>{item.units === 'unknown' ? t('canvas.lidar.library.unitUnknown') : item.units}</dd>
        {item.resolutionM !== null && <>
          <dt>{t('canvas.lidar.library.factResolution')}</dt>
          <dd>{formatMetres(item.resolutionM)}</dd>
        </>}
        {item.displayRange && <>
          <dt>{t('canvas.lidar.library.factRange')}</dt>
          <dd>{`${item.displayRange[0].toFixed(1)} – ${item.displayRange[1].toFixed(1)} ${item.units}`}</dd>
        </>}
        <dt>{t('canvas.lidar.library.factStatus')}</dt>
        <dd>{item.status === 'ready' ? t('canvas.lidar.library.ready') : statusLabel(item)}</dd>
        {item.kind === 'Analysis' && <>
          <dt>{t('canvas.lidar.library.factInput')}</dt>
          <dd>{input
            ? <button type="button" className={styles.link} onClick={() => onOpen(input.id)}>{input.name}</button>
            : t('canvas.lidar.library.dataUnavailable')}</dd>
          <dt>{t('canvas.lidar.library.factMethod')}</dt>
          <dd>{methodLabel(item.method)}</dd>
          {item.engineVersion && <>
            <dt>{t('canvas.lidar.library.factEngine')}</dt>
            <dd className={styles.filename}>{item.engineVersion}</dd>
          </>}
        </>}
        {item.kind === 'Source' && item.resultCount > 0 && <>
          <dt>{t('canvas.lidar.library.factResults')}</dt>
          <dd>{item.resultCount}</dd>
        </>}
      </dl>
      {item.status === 'ready' && addButton}
      {item.kind === 'Source' && item.status === 'ready' && (
        <button type="button" onClick={onCalculate}>{t('canvas.lidar.library.calculateSlope')}</button>
      )}
      {operation}
      {item.kind === 'Analysis' && item.status === 'failed' && item.inputGenerationId !== null && (
        <button type="button" disabled={busy} onClick={onRetryCalculation}>{t('canvas.lidar.library.retry')}</button>
      )}
      {item.kind === 'Source' && files && files.length > 0 && (
        <details>
          <summary>{t('canvas.lidar.library.sourceFiles', { count: files.length })}</summary>
          <ol className={styles.files}>{files.map((file, index) => <li key={`${index}-${file}`} className={styles.filename}>{file}</li>)}</ol>
        </details>
      )}
    </div>
  )
}

function RenameForm({ item, busy, error, onCancel, onSubmit }: {
  item: LibraryItem
  busy: boolean
  error: string | null
  onCancel(): void
  onSubmit(name: string): void
}) {
  const [name, setName] = useState(item.name)
  return (
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSubmit(name.trim()) }}>
      <h3>{t('canvas.lidar.library.renameTitle')}</h3>
      <label>
        {t('canvas.lidar.library.name')}
        <input required value={name} onInput={(event) => setName(event.currentTarget.value)} />
      </label>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.formActions}>
        <button type="button" onClick={onCancel}>{t('canvas.lidar.library.cancel')}</button>
        <button type="submit" className={styles.primary} disabled={busy || !name.trim()}>{t('canvas.lidar.library.saveName')}</button>
      </div>
    </form>
  )
}

function DeleteConfirmation({ item, inCurrentDesign, busy, error, onKeep, onShowResults, onDelete }: {
  item: LibraryItem
  inCurrentDesign: boolean
  busy: boolean
  error: string | null
  onKeep(): void
  onShowResults(): void
  onDelete(): void
}) {
  const [impact, setImpact] = useState<LidarDeleteImpact | null>(null)
  useEffect(() => {
    if (item.kind !== 'Source') return
    let current = true
    void fetchDeleteImpact(item.id).then((value) => { if (current) setImpact(value) }).catch(() => {})
    return () => { current = false }
  }, [item.id])
  const dependents = item.kind === 'Source' ? impact?.analysis_count ?? item.resultCount : 0
  return (
    <div className={styles.form}>
      <h3 tabIndex={-1} data-autofocus="true">{t('canvas.lidar.library.deleteTitle', { name: item.name })}</h3>
      {dependents > 0 ? <>
        <p>{t('canvas.lidar.library.deleteBlocked', { count: dependents })}</p>
        <div className={styles.formActions}>
          <button type="button" onClick={onKeep}>{t('canvas.lidar.library.keep')}</button>
          <button type="button" onClick={onShowResults}>{t('canvas.lidar.library.showResults')}</button>
        </div>
      </> : <>
        <p>{inCurrentDesign ? t('canvas.lidar.library.deleteBodyInDesign') : t('canvas.lidar.library.deleteBody')}</p>
        <p className={styles.muted}>{t('canvas.lidar.library.deleteOtherDesigns')}</p>
        <p className={styles.muted}>{t('canvas.lidar.library.deleteNoUndo')}</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.formActions}>
          <button type="button" onClick={onKeep}>{t('canvas.lidar.library.keep')}</button>
          <button type="button" className={styles.danger} disabled={busy || item.status === 'preparing'} onClick={onDelete}>
            {t('canvas.lidar.library.deleteFromLibrary')}
          </button>
        </div>
      </>}
    </div>
  )
}

const INELIGIBLE: Record<SlopeIneligibility, string> = {
  notSource: 'canvas.lidar.library.slopeNeedsSource',
  notReady: 'canvas.lidar.library.slopeNeedsSource',
  notGround: 'canvas.lidar.library.slopeNeedsGround',
  notMetres: 'canvas.lidar.library.slopeNeedsMetres',
  engine: 'canvas.lidar.library.slopeEngineMissing',
}

/**
 * One contextual operation: slope from a fixed input as a new library result.
 * With a single qualified method there is no algorithm picker; the method is
 * named in the result's details.
 */
function CalculateSlopeForm({ item, reason, engineDetail, attach, busy, error, onCancel, onSubmit }: {
  item: LibraryItem
  reason: SlopeIneligibility | null
  engineDetail: string | null
  attach: boolean
  busy: boolean
  error: string | null
  onCancel(): void
  onSubmit(unit: LidarSlopeUnit, name: string): void
}) {
  const [name, setName] = useState(`${item.name} · ${t('canvas.lidar.library.typeSlope')}`)
  const [unit, setUnit] = useState<LidarSlopeUnit>('Degrees')
  return (
    <form className={styles.form} onSubmit={(event) => {
      event.preventDefault()
      if (!reason && name.trim() && !busy) onSubmit(unit, name.trim())
    }}>
      <h3 tabIndex={-1} data-autofocus="true">{t('canvas.lidar.library.calculateTitle')}</h3>
      <p>{t('canvas.lidar.library.calculateFrom', { name: item.name })}</p>
      {reason ? (
        <p className={styles.error} role="alert">
          {t(INELIGIBLE[reason])}{reason === 'engine' && engineDetail ? ` (${engineDetail})` : ''}
        </p>
      ) : <>
        <label>
          {t('canvas.lidar.library.resultName')}
          <input required value={name} onInput={(event) => setName(event.currentTarget.value)} />
        </label>
        <fieldset className={styles.unit}>
          <legend>{t('canvas.lidar.library.unit')}</legend>
          {(['Degrees', 'Percent'] as const).map((value) => (
            <label key={value} className={styles.check}>
              <input type="radio" name="slope-unit" checked={unit === value} onChange={() => setUnit(value)} />
              {t(`canvas.lidar.library.unit${value}`)}
            </label>
          ))}
        </fieldset>
        <p className={styles.muted}>
          {attach ? t('canvas.lidar.library.calculateAttachNote') : t('canvas.lidar.library.calculateLibraryNote')}
        </p>
      </>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.formActions}>
        <button type="button" onClick={onCancel}>{t('canvas.lidar.library.cancel')}</button>
        <button type="submit" className={styles.primary} disabled={busy || reason !== null || !name.trim()}>
          {t('canvas.lidar.library.run')}
        </button>
      </div>
    </form>
  )
}
