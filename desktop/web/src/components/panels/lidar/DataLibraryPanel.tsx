import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { currentDesign } from '../../../app/document-session/store'
import {
  addToDesign,
  cancelAnalysisJob,
  cancelLibraryImport,
  chooseImportFiles,
  deleteLibraryItem,
  dismissLibraryImport,
  fetchDeleteImpact,
  fetchItemSources,
  fetchProcessingHistory,
  importLibraryItem,
  renameLibraryItem,
  rerunAnalysis,
  retryLibraryImport,
  runAnalysis,
} from '../../../app/lidar/actions'
import type { AnalysisContext } from '../../../app/analyses/model'
import { analysisTitle, findAnalysis } from '../../../app/analyses/registry'
import { IMPORTABLE_QUANTITIES, RASTER_QUANTITIES, itemTypeLabel } from '../../../app/lidar/item-types'
import {
  filterLibraryItems,
  libraryItems,
  suggestedItemName,
  type LibraryItem,
  type LibraryTypeFilter,
} from '../../../app/lidar/library-items'
import { installLidarLibraryObserver, lidarLibrary, lidarStatusMessage } from '../../../app/lidar/library-store'
import { libraryAnalyzeRequest, libraryFocusRequest, showInLayers } from '../../../app/lidar/library-navigation'
import { locale } from '../../../app/settings/state'
import { ANALYSIS_GROUPS } from '../../../generated/analysis-registry'
import type {
  LibraryDeleteImpact,
  ProcessingRun,
  Provenance,
  RasterQuantity,
} from '../../../generated/contracts'
import { t } from '../../../i18n'
import { ActionMenu } from '../../shared/ActionMenu'
import { DockPanelHeader } from '../../shared/DockPanelHeader'
import { Notice } from '../../shared/Notice'
import { SurfaceSearch } from '../../shared/SurfaceSearch'
import { AnalyzeDialog } from '../analyze/AnalyzeDialog'
import { formatTimestamp, paramValueText, staleReasonText } from '../analyze/analysis-text'
import { LibraryPreview, usePreviewClient } from './LibraryPreview'
import styles from './data-library.module.css'

type View =
  | { readonly kind: 'list' }
  | { readonly kind: 'import'; readonly paths: readonly string[] }
  | { readonly kind: 'details' | 'rename' | 'delete'; readonly id: string }
  | { readonly kind: 'analyze'; readonly id: string; readonly attach: boolean; readonly analysisId: string | null }

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
  const items = useMemo(() => libraryItems(snapshot), [snapshot, locale.value])
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
  const nameOf = (id: string) => items.find((candidate) => candidate.id === id)?.name ?? t('canvas.lidar.library.dataUnavailable')
  const analysisContext = useMemo<AnalysisContext>(() => ({
    edition: 'desktop',
    results: items.filter((candidate) => candidate.role === 'Derived'),
    inDesign: new Set(references.map((entry) => entry.id)),
  }), [items, references])

  // Another surface (Layers) can ask to show one item's details.
  useEffect(() => {
    const request = libraryFocusRequest.value
    if (!request) return
    libraryFocusRequest.value = null
    open({ kind: 'details', id: request })
  }, [libraryFocusRequest.value])

  // Layers can ask to analyze an item; its results join the asking Design.
  useEffect(() => {
    const request = libraryAnalyzeRequest.value
    if (!request) return
    libraryAnalyzeRequest.value = null
    open({ kind: 'analyze', id: request.itemId, attach: true, analysisId: request.analysisId })
  }, [libraryAnalyzeRequest.value])

  useLayoutEffect(() => {
    if (view.kind === 'list' && restoringList.current) {
      restoringList.current = false
      if (scroll.current) scroll.current.scrollTop = savedScroll.current
      const target = restoreFocusId.current
        ? document.getElementById(`library-item-${restoreFocusId.current}`)
        : null
      ;(target ?? scroll.current?.querySelector<HTMLElement>('input'))?.focus({ preventScroll: true })
    } else if (view.kind !== 'list' && view.kind !== 'analyze') {
      // The Analyze dialog focuses its own first control.
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
  const refresh = (row: LibraryItem) => {
    const definitionId = row.provenance?.definition_id
    if (definitionId) void run(() => rerunAnalysis(definitionId))
  }

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
        onClick={() => addToDesign(row.role, row.id)}
      >
        {added ? t('canvas.lidar.library.added') : t('canvas.lidar.library.addToDesign')}
      </button>
    )
  }
  const refreshButton = (row: LibraryItem) => isStale(row) && !isRunning(row) && (
    <button
      type="button"
      disabled={busy}
      aria-label={t('analyses.details.refreshAria', { name: row.name })}
      onClick={() => refresh(row)}
    >
      {t('analyses.details.refresh')}
    </button>
  )
  const menu = (row: LibraryItem) => (
    <ActionMenu label={t('canvas.lidar.library.actionsFor', { name: row.name })} items={[
      ...(row.status === 'ready'
        ? [
            { label: t('canvas.lidar.library.analyze'), run: () => open({ kind: 'analyze', id: row.id, attach: false, analysisId: null }) },
            { label: t('canvas.lidar.library.rename'), run: () => open({ kind: 'rename', id: row.id }) },
          ]
        : []),
      ...(row.status === 'ready' || row.role === 'Derived'
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
    if (isRunning(row)) {
      return (
        <div className={styles.job}>
          <span role="status" data-tone="progress">
            {row.status === 'ready' ? t('analyses.details.refreshing') : t('canvas.lidar.library.calculating')}
          </span>
          <button type="button" onClick={() => void run(() => cancelAnalysisJob(row))}>
            {t('canvas.lidar.library.cancel')}
          </button>
        </div>
      )
    }
    if (row.status === 'failed' && row.role === 'Source') {
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
    if (row.status === 'failed' && row.role === 'Derived') {
      return (
        <div className={styles.job}>
          {row.run?.state !== 'Cancelled' && (
            <span role="status">{row.message || t('canvas.lidar.library.calculationFailed')}</span>
          )}
          <button type="button" disabled={busy || !row.provenance} onClick={() => refresh(row)}>
            {t('canvas.lidar.library.retry')}
          </button>
        </div>
      )
    }
    if (row.status === 'ready' && row.run?.state === 'Failed') {
      return (
        <div className={styles.job}>
          <span role="status">{t('analyses.details.refreshFailed', { message: row.run.message ?? '' })}</span>
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
                {ANALYSIS_GROUPS.map((group) => <option key={group.key} value={group.key}>{t(group.labelKey)}</option>)}
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
                <li className={styles.item} key={row.id} data-nested={row.depth > 0}>
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
                        {isStale(row) && <small className={styles.stale}>{t('analyses.details.outOfDate')}</small>}
                      </span>
                    </button>
                    {menu(row)}
                  </div>
                  {row.status === 'ready' && <div className={styles.rowActions}>{addButton(row)}{refreshButton(row)}</div>}
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
            onSubmit={(name, quantity, unit) => void run(
              () => importLibraryItem([...view.paths], name, quantity, unit),
              () => { restoreFocusId.current = null; back() },
            )}
          />
        )}
        {view.kind === 'details' && item && (
          <ItemDetails
            item={item}
            client={client}
            nameOf={nameOf}
            addButton={addButton(item)}
            refreshButton={refreshButton(item)}
            menu={menu(item)}
            operation={operation(item)}
            onOpen={(id) => open({ kind: 'details', id })}
            onAnalyze={() => open({ kind: 'analyze', id: item.id, attach: false, analysisId: null })}
          />
        )}
        {view.kind === 'analyze' && item && (
          <AnalyzeDialog
            item={item}
            context={analysisContext}
            attach={view.attach}
            canAddToDesign={currentDesign.value !== null}
            initialAnalysisId={view.analysisId}
            busy={busy}
            error={error}
            onCancel={back}
            onRun={(request) => void run(
              () => runAnalysis(request, view.attach),
              () => { restoreFocusId.current = null; back() },
            )}
            onShowInLayers={showInLayers}
            onAddExisting={(id) => { addToDesign('Derived', id); back() }}
          />
        )}
        {view.kind !== 'list' && view.kind !== 'import' && !item && <p className={styles.muted}>{t('canvas.lidar.library.itemGone')}</p>}
        {view.kind === 'rename' && item && (
          <RenameForm item={item} busy={busy} error={error} onCancel={back}
            onSubmit={(name) => void run(() => renameLibraryItem(item.id, name), back)} />
        )}
        {view.kind === 'delete' && item && (
          <DeleteConfirmation
            item={item}
            inCurrentDesign={isAdded(item)}
            busy={busy}
            error={error}
            onKeep={back}
            onShowResults={() => { setRelatedTo(item.id); setQuery(''); setType('all'); back() }}
            onDelete={() => void run(() => deleteLibraryItem(item.id), () => { restoreFocusId.current = null; back() })}
          />
        )}
      </div>
    </div>
  )
}

function isStale(row: LibraryItem): boolean {
  return row.status === 'ready' && row.freshness.state === 'Stale'
}

function isRunning(row: LibraryItem): boolean {
  return row.role === 'Derived' && row.run?.state === 'Preparing'
}

function summary(row: LibraryItem): string {
  const type = itemTypeLabel(row.itemType)
  if (row.role === 'Derived') return row.units ? `${type} · ${row.units}` : type
  const resolution = row.resolutionM !== null ? ` · ${formatMetres(row.resolutionM)}` : ''
  return `${type}${resolution}`
}

function statusLabel(row: LibraryItem): string {
  if (row.status === 'preparing') {
    const phase = row.importJob?.progress?.phase
    return phase ? t(`canvas.lidar.progressPhase.${phase}`) : t('canvas.lidar.library.preparing')
  }
  if (row.importJob?.state === 'Cancelled' || row.run?.state === 'Cancelled') return t('canvas.lidar.library.cancelled')
  return row.role === 'Derived' ? t('canvas.lidar.library.calculationFailed') : t('canvas.lidar.library.importFailed')
}

function formatMetres(value: number): string {
  return `${value >= 10 ? value.toFixed(0) : value >= 1 ? value.toFixed(1) : value.toFixed(2)} m`
}

function ImportForm({ paths, busy, error, onCancel, onSubmit }: {
  paths: readonly string[]
  busy: boolean
  error: string | null
  onCancel(): void
  onSubmit(name: string, quantity: RasterQuantity, unit: { label: string | null; unknown: boolean }): void
}) {
  const [name, setName] = useState(() => suggestedItemName(paths))
  const [quantity, setQuantity] = useState<RasterQuantity | ''>('')
  const [unitLabel, setUnitLabel] = useState('')
  const [unitUnknown, setUnitUnknown] = useState(false)
  const unitReady = quantity !== 'OtherContinuous' || unitUnknown || unitLabel.trim() !== ''
  return (
    <form className={styles.form} onSubmit={(event) => {
      event.preventDefault()
      if (!quantity || !name.trim() || !unitReady || busy) return
      onSubmit(name.trim(), quantity, quantity === 'OtherContinuous'
        ? { label: unitUnknown ? null : unitLabel.trim(), unknown: unitUnknown }
        : { label: null, unknown: false })
    }}>
      <h3 tabIndex={-1} data-autofocus="true">{t('canvas.lidar.library.importTitle')}</h3>
      <label>
        {t('canvas.lidar.library.name')}
        <input required value={name} onInput={(event) => setName(event.currentTarget.value)} />
      </label>
      <label>
        {t('canvas.lidar.library.quantityLabel')}
        <select required value={quantity} onChange={(event) => setQuantity(event.currentTarget.value as RasterQuantity)}>
          <option value="" disabled>{t('canvas.lidar.library.chooseQuantity')}</option>
          {IMPORTABLE_QUANTITIES.map((value) => (
            <option key={value} value={value}>{t(RASTER_QUANTITIES[value].labelKey)}</option>
          ))}
        </select>
      </label>
      {quantity === 'OtherContinuous' && (
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
        <button type="submit" className={styles.primary} disabled={busy || !quantity || !name.trim() || !unitReady}>
          {t('canvas.lidar.library.importFiles', { count: paths.length })}
        </button>
      </div>
    </form>
  )
}

function ItemDetails({ item, client, nameOf, addButton, refreshButton, menu, operation, onOpen, onAnalyze }: {
  item: LibraryItem
  client: ReturnType<typeof usePreviewClient>
  nameOf(id: string): string
  addButton: preact.ComponentChildren
  refreshButton: preact.ComponentChildren
  menu: preact.ComponentChildren
  operation: preact.ComponentChildren
  onOpen(id: string): void
  onAnalyze(): void
}) {
  const [files, setFiles] = useState<string[] | null>(null)
  useEffect(() => {
    setFiles(null)
    if (item.role !== 'Source' || item.status !== 'ready') return
    let current = true
    void fetchItemSources(item.id)
      .then((page) => { if (current) setFiles(page.sources.map((source) => source.filename)) })
      .catch(() => { if (current) setFiles([]) })
    return () => { current = false }
  }, [item.id, item.status])
  return (
    <div className={styles.form}>
      <div className={styles.detailTitle}>
        <h3 tabIndex={-1} data-autofocus="true">{item.name}</h3>
        {menu}
      </div>
      <div className={styles.previewFrame}>
        <LibraryPreview item={item} client={client} width={640} height={328} large />
      </div>
      {isStale(item) && item.freshness.state === 'Stale' && (
        <Notice tone="warning" action={refreshButton}>
          <strong>{t('analyses.details.outOfDate')}</strong>
          <ul className={styles.reasons}>
            {item.freshness.reasons.map((reason, index) => <li key={index}>{staleReasonText(reason, nameOf)}</li>)}
          </ul>
        </Notice>
      )}
      <dl className={styles.facts}>
        <dt>{t('canvas.lidar.library.factType')}</dt>
        <dd>{itemTypeLabel(item.itemType)}</dd>
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
        {item.provenance && <ProvenanceFacts provenance={item.provenance} nameOf={nameOf} onOpen={onOpen} />}
        {item.dependents > 0 && <>
          <dt>{t('canvas.lidar.library.factResults')}</dt>
          <dd>{item.dependents}</dd>
        </>}
      </dl>
      {item.status === 'ready' && addButton}
      {item.status === 'ready' && (
        <button type="button" onClick={onAnalyze}>{t('canvas.lidar.library.analyze')}</button>
      )}
      {operation}
      {item.role === 'Source' && files && files.length > 0 && (
        <details>
          <summary>{t('canvas.lidar.library.sourceFiles', { count: files.length })}</summary>
          <ol className={styles.files}>{files.map((file, index) => <li key={`${index}-${file}`} className={styles.filename}>{file}</li>)}</ol>
        </details>
      )}
      {item.provenance && <ProcessingHistory key={item.provenance.definition_id} definitionId={item.provenance.definition_id} />}
    </div>
  )
}

/** What produced a derived item: analysis, method version, settings, inputs, engine and date. */
function ProvenanceFacts({ provenance, nameOf, onOpen }: {
  provenance: Provenance
  nameOf(id: string): string
  onOpen(id: string): void
}) {
  const language = locale.value
  const entry = findAnalysis(provenance.analysis_id)
  const tool = provenance.tool
  return <>
    <dt>{t('analyses.details.analysis')}</dt>
    <dd>{analysisTitle(provenance.analysis_id)}</dd>
    <dt>{t('analyses.details.method')}</dt>
    <dd>{t('analyses.details.methodVersion', { version: provenance.recipe_version })}</dd>
    {provenance.parameters.map((parameter) => {
      const spec = entry?.params.find((param) => param.key === parameter.key)
      return [
        <dt key={`${parameter.key}-label`}>{spec ? t(spec.labelKey) : parameter.key}</dt>,
        <dd key={`${parameter.key}-value`}>{paramValueText(entry, parameter, language)}</dd>,
      ]
    })}
    <dt>{t('analyses.details.inputs')}</dt>
    <dd>
      {provenance.inputs.map((input) => (
        <button key={input.key} type="button" className={styles.link} onClick={() => onOpen(input.item_id)}>
          {nameOf(input.item_id)}
        </button>
      ))}
    </dd>
    {tool && <>
      <dt>{t('analyses.details.engine')}</dt>
      <dd className={styles.filename}>{tool.version}</dd>
      <dt>{t('analyses.details.revision')}</dt>
      <dd className={styles.filename}>{tool.revision.slice(0, 12)}</dd>
    </>}
    <dt>{t('analyses.details.created')}</dt>
    <dd>{formatTimestamp(provenance.created_at, language)}</dd>
  </>
}

/** The runs of one definition, loaded when opened and paged on request. */
function ProcessingHistory({ definitionId }: { definitionId: string }) {
  const [runs, setRuns] = useState<ProcessingRun[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const language = locale.value
  const load = (from: string | null) => {
    setLoading(true)
    setFailed(false)
    void fetchProcessingHistory(definitionId, from)
      .then((page) => {
        setRuns((previous) => [...(from ? previous ?? [] : []), ...page.runs])
        setCursor(page.next_cursor)
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }
  return (
    <details onToggle={(event) => { if (event.currentTarget.open && runs === null && !loading) load(null) }}>
      <summary>{t('analyses.details.history')}</summary>
      {runs !== null && runs.length === 0 && <p className={styles.muted}>{t('analyses.details.historyEmpty')}</p>}
      {runs !== null && runs.length > 0 && (
        <ol className={styles.history}>
          {runs.map((entry) => (
            <li key={entry.job_id}>
              <strong>{formatTimestamp(entry.created_at, language)}</strong>
              <span>{t(`analyses.details.runState.${entry.state}`)}{entry.tool ? ` · ${entry.tool.version}` : ''}</span>
              <span className={styles.muted}>{runOutputs(entry, language)}</span>
              {entry.message && <span className={styles.muted}>{entry.message}</span>}
            </li>
          ))}
        </ol>
      )}
      {loading && <p className={styles.muted} role="status">{t('analyses.details.historyLoading')}</p>}
      {failed && <p className={styles.error} role="alert">{t('analyses.details.historyFailed')}</p>}
      {cursor && !loading && (
        <button type="button" onClick={() => load(cursor)}>{t('analyses.details.showMore')}</button>
      )}
    </details>
  )
}

function runOutputs(run: ProcessingRun, language: string): string {
  if (run.outputs.length === 0) return t('analyses.details.noOutputs')
  const cells = run.outputs.reduce((total, output) => total + Number(output.coverage_cells ?? 0), 0)
  return t('analyses.details.coverage', { cells: new Intl.NumberFormat(language).format(cells) })
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
  const [impact, setImpact] = useState<LibraryDeleteImpact | null>(null)
  useEffect(() => {
    let current = true
    void fetchDeleteImpact(item.id).then((value) => { if (current) setImpact(value) }).catch(() => {})
    return () => { current = false }
  }, [item.id])
  const dependents = impact?.dependent_item_ids.length ?? item.dependents
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
          <button type="button" className={styles.danger} disabled={busy || item.status === 'preparing' || isRunning(item)} onClick={onDelete}>
            {t('canvas.lidar.library.deleteFromLibrary')}
          </button>
        </div>
      </>}
    </div>
  )
}
