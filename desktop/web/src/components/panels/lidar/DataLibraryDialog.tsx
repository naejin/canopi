import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { currentDesign } from '../../../app/document-session/store'
import {
  addToDesign,
  cancelAnalysisJob,
  cancelLibraryImport,
  deleteLibraryItem,
  dismissLibraryImport,
  fetchDeleteImpact,
  fetchLibraryDiskUsage,
  renameLibraryItem,
  rerunAnalysis,
  retryLibraryImport,
  showDataLibraryFolder,
} from '../../../app/lidar/actions'
import { findAnalysis } from '../../../app/analyses/registry'
import {
  filterLibraryItems,
  libraryItems,
  type LibraryItem,
  type LibraryTypeFilter,
} from '../../../app/lidar/library-items'
import { installLidarLibraryObserver, lidarLibrary, lidarStatusMessage } from '../../../app/lidar/library-store'
import { analyzeItem, beginDataImport, closeDataDialog } from '../../../app/lidar/library-navigation'
import { locale } from '../../../app/settings/state'
import { ANALYSIS_GROUPS } from '../../../generated/analysis-registry'
import type { LibraryDeleteImpact } from '../../../generated/contracts'
import { t } from '../../../i18n'
import { ActionMenu } from '../../shared/ActionMenu'
import { Dropdown, type DropdownItem } from '../../shared/Dropdown'
import { SurfaceSearch } from '../../shared/SurfaceSearch'
import { WorkspaceDialog } from '../../shared/WorkspaceDialog'
import { ItemDetails } from './ItemDetails'
import { formatDiskSize, isRunning, isStale, itemStatusLabel, itemSummary } from './item-text'
import { LibraryPreview, usePreviewClient } from './LibraryPreview'
import styles from './data-library.module.css'

type View =
  | { readonly kind: 'list' }
  | { readonly kind: 'details' | 'rename' | 'delete'; readonly id: string }

/**
 * The Data library: terrain and height data shared by every Design, with the
 * results calculated from it. Import creates library items; Add to Design is
 * the attachment step from here. Search, filter, scroll and detail navigation
 * are session view state and never enter a Design. Library work keeps running
 * when the dialog closes or the Design changes; only an explicit Cancel stops
 * it. Deleting here removes an item from every Design; removing it from a
 * Design (in Layers) never deletes it. The footer counts the items, says how
 * much space the library takes on this computer and opens its folder.
 */
export function DataLibraryDialog({ focusId }: { readonly focusId: string | null }) {
  useEffect(() => installLidarLibraryObserver(), [])
  const client = usePreviewClient()
  const snapshot = lidarLibrary.value
  const items = useMemo(() => libraryItems(snapshot), [snapshot, locale.value])
  const references = currentDesign.value?.lidar?.entries ?? []
  const [view, setView] = useState<View>(() => focusId ? { kind: 'details', id: focusId } : { kind: 'list' })
  const [query, setQuery] = useState('')
  const [type, setType] = useState<LibraryTypeFilter>('all')
  const [relatedTo, setRelatedTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [diskUsage, setDiskUsage] = useState<number | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const savedScroll = useRef(0)
  const restoreFocusId = useRef<string | null>(null)
  const restoringList = useRef(false)

  // Measured again when the items change (an import, a result, a deletion).
  const itemsKey = items.map((row) => `${row.id}:${row.generationId ?? ''}`).join(',')
  useEffect(() => {
    let current = true
    void fetchLibraryDiskUsage().then((bytes) => { if (current) setDiskUsage(bytes) }, () => {})
    return () => { current = false }
  }, [itemsKey])

  const visible = filterLibraryItems(items, query, type, relatedTo)
  const item = 'id' in view ? items.find((candidate) => candidate.id === view.id) ?? null : null
  const isAdded = (row: LibraryItem) => references.some((entry) => entry.id === row.id)
  const nameOf = (id: string) => items.find((candidate) => candidate.id === id)?.name ?? t('canvas.lidar.library.dataUnavailable')

  useLayoutEffect(() => {
    const scroller = body.current?.closest<HTMLElement>('[role="dialog"] > div') ?? null
    if (view.kind === 'list' && restoringList.current) {
      restoringList.current = false
      if (scroller) scroller.scrollTop = savedScroll.current
      const target = restoreFocusId.current
        ? document.getElementById(`library-item-${restoreFocusId.current}`)
        : null
      ;(target ?? body.current?.querySelector<HTMLElement>('input'))?.focus({ preventScroll: true })
    } else if (view.kind !== 'list') {
      body.current?.querySelector<HTMLElement>('[data-autofocus="true"]')?.focus()
    }
  }, [view])

  const open = (next: View) => {
    const scroller = body.current?.closest<HTMLElement>('[role="dialog"] > div') ?? null
    if (view.kind === 'list') savedScroll.current = scroller?.scrollTop ?? 0
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
  const beginImport = () => void run(() => beginDataImport({ attach: false, returnTo: 'library' }))
  const refresh = (row: LibraryItem) => {
    const definitionId = row.provenance?.definition_id
    if (definitionId) void run(() => rerunAnalysis(definitionId))
  }

  // "Run again with changes" analyzes the result's first input again, starting
  // from the settings and outputs of the run that produced it.
  const rerunSubject = (row: LibraryItem) => {
    const inputId = row.provenance?.inputs[0]?.item_id
    const input = inputId ? items.find((candidate) => candidate.id === inputId) : undefined
    return input?.status === 'ready' && row.provenance && findAnalysis(row.provenance.analysis_id) ? input : null
  }

  const addButton = (row: LibraryItem) => isAdded(row)
    ? <span className={styles.badge}>{t('canvas.lidar.library.inThisDesign')}</span>
    : (
      <button
        type="button"
        className={styles.add}
        disabled={row.status !== 'ready' || !currentDesign.value}
        aria-label={t('canvas.lidar.library.addAria', { name: row.name })}
        onClick={() => addToDesign(row.role, row.id)}
      >
        {t('canvas.lidar.library.addToDesign')}
      </button>
    )
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
            { label: t('canvas.lidar.library.analyze'), opensDialog: true, run: () => analyzeItem(row.id, { attach: false, returnTo: 'library' }) },
            { label: t('canvas.lidar.library.rename'), run: () => open({ kind: 'rename', id: row.id }) },
          ]
        : []),
      ...(rerunSubject(row)
        ? [{
            label: t('canvas.lidar.library.runAgainWithChanges'),
            opensDialog: true,
            run: () => analyzeItem(rerunSubject(row)!.id, {
              attach: false,
              analysisId: row.provenance!.analysis_id,
              from: row.id,
              returnTo: 'library',
            }),
          }]
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
            {t('canvas.lidar.layers.cancelImport')}
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
            {t('canvas.lidar.layers.cancelCalculation')}
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

  const count = items.length
  return (
    <WorkspaceDialog
      title={t('canvas.lidar.library.title')}
      onClose={closeDataDialog}
      wide
      footer={<>
        <span className={styles.footerNote}>
          {t('canvas.lidar.library.itemCount', { count })}
          {diskUsage !== null && ` · ${t('canvas.lidar.library.onThisComputer', { size: formatDiskSize(diskUsage, locale.value) })}`}
        </span>
        <button type="button" className={`${styles.dialogButton} ${styles.ghost}`} onClick={() => void run(showDataLibraryFolder)}>
          {t('canvas.lidar.library.showInFolder')}
        </button>
        <button type="button" className={styles.dialogButton} onClick={closeDataDialog}>{t('canvas.lidar.library.done')}</button>
      </>}
    >
      <div className={styles.library} ref={body}>
        {(error || lidarStatusMessage.value) && view.kind === 'list' && (
          <p className={styles.error} role="alert">{error ?? lidarStatusMessage.value}</p>
        )}
        {view.kind === 'list' && <>
          <div className={styles.filters}>
            <div className={styles.search}>
              <SurfaceSearch value={query} onChange={(value) => { setQuery(value); setRelatedTo(null) }} label={t('canvas.lidar.library.searchLabel')} />
            </div>
            <TypeFilter value={type} onChange={(next) => { setType(next); setRelatedTo(null) }} />
            <button type="button" className={`${styles.dialogButton} ${styles.primary}`} disabled={busy} onClick={beginImport}>
              {t('canvas.lidar.library.import')}
            </button>
          </div>
          {relatedTo !== null && (
            <button type="button" className={styles.link} onClick={() => setRelatedTo(null)}>
              {t('canvas.lidar.library.showAll')}
            </button>
          )}
          {count === 0 ? (
            <div className={styles.empty}>
              <h3>{t('canvas.lidar.library.emptyTitle')}</h3>
              <p>{t('canvas.lidar.library.emptyBody')}</p>
              <p className={styles.muted}>{t('canvas.lidar.import.supported')}</p>
              <button type="button" className={styles.dialogButton} onClick={beginImport}>{t('canvas.lidar.library.emptyAction')}</button>
            </div>
          ) : (
            <ul className={styles.list}>
              {visible.map((row) => (
                <li className={styles.item} key={row.id} data-nested={row.depth > 0}>
                  <button
                    type="button"
                    id={`library-item-${row.id}`}
                    className={styles.identity}
                    onClick={() => open({ kind: 'details', id: row.id })}
                  >
                    <LibraryPreview item={row} client={client} width={104} height={84} />
                    <span>
                      <strong>{row.name}</strong>
                      <small>{itemSummary(row)}</small>
                      {row.status !== 'ready' && (
                        <small data-error={row.status === 'failed'}>{itemStatusLabel(row)}</small>
                      )}
                      {isStale(row) && <small className={styles.stale}>{t('analyses.details.outOfDate')}</small>}
                    </span>
                  </button>
                  <div className={styles.rowActions}>
                    {refreshButton(row)}
                    {row.status === 'ready' && addButton(row)}
                    {menu(row)}
                  </div>
                  {operation(row)}
                </li>
              ))}
            </ul>
          )}
          {count > 0 && visible.length === 0 && (
            <div className={styles.empty}>
              <p role="status">{t('canvas.lidar.library.noMatch')}</p>
              <button type="button" className={styles.dialogButton} onClick={() => { setQuery(''); setType('all'); setRelatedTo(null) }}>
                {t('canvas.lidar.library.clearFilters')}
              </button>
            </div>
          )}
          <p className={styles.muted}>{t('canvas.lidar.library.removeHint')}</p>
        </>}

        {view.kind !== 'list' && (
          <button type="button" className={styles.back} onClick={back}>← {t('canvas.lidar.library.back')}</button>
        )}
        {view.kind === 'details' && item && <>
          <div className={styles.detailTitle}>
            <h3 tabIndex={-1} data-autofocus="true">{item.name}</h3>
            {menu(item)}
          </div>
          <ItemDetails
            item={item}
            nameOf={nameOf}
            busy={busy}
            onRefresh={() => refresh(item)}
            onOpenInput={(id) => open({ kind: 'details', id })}
            preview={<div className={styles.previewFrame}><LibraryPreview item={item} client={client} width={640} height={328} large /></div>}
            actions={item.status === 'ready' && <>
              {addButton(item)}
              <button type="button" onClick={() => analyzeItem(item.id, { attach: false, returnTo: 'library' })}>
                {t('canvas.lidar.library.analyze')}
              </button>
            </>}
            operation={operation(item)}
          />
        </>}
        {view.kind !== 'list' && !item && <p className={styles.muted}>{t('canvas.lidar.library.itemGone')}</p>}
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
    </WorkspaceDialog>
  )
}

/** The library's type filter: everything, imported data, or one analysis group from the registry. */
function TypeFilter({ value, onChange }: { value: LibraryTypeFilter; onChange(next: LibraryTypeFilter): void }) {
  const items: DropdownItem<LibraryTypeFilter>[] = [
    { value: 'all', label: t('canvas.lidar.library.typeAll') },
    { value: 'sources', label: t('canvas.lidar.library.typeSources') },
    ...ANALYSIS_GROUPS.map((group) => ({ value: group.key, label: t(group.labelKey) })),
  ]
  return (
    <Dropdown
      className={styles.filterDropdown}
      ariaLabel={t('canvas.lidar.library.typeLabel')}
      trigger={items.find((item) => item.value === value)?.label ?? ''}
      items={items}
      value={value}
      onChange={onChange}
    />
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
      <label className={styles.field}>
        <span>{t('canvas.lidar.library.name')}</span>
        <input required value={name} data-autofocus="true" onInput={(event) => setName(event.currentTarget.value)} />
      </label>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.formActions}>
        <button type="button" className={styles.dialogButton} onClick={onCancel}>{t('canvas.lidar.library.cancel')}</button>
        <button type="submit" className={`${styles.dialogButton} ${styles.primary}`} disabled={busy || !name.trim()}>{t('canvas.lidar.library.saveName')}</button>
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
    <div className={styles.form} role="alertdialog" aria-labelledby="library-delete-title">
      <h3 id="library-delete-title" tabIndex={-1} data-autofocus="true">{t('canvas.lidar.library.deleteTitle', { name: item.name })}</h3>
      {dependents > 0 ? <>
        <p>{t('canvas.lidar.library.deleteBlocked', { count: dependents })}</p>
        <div className={styles.formActions}>
          <button type="button" className={styles.dialogButton} onClick={onKeep}>{t('canvas.lidar.library.keep')}</button>
          <button type="button" className={styles.dialogButton} onClick={onShowResults}>{t('canvas.lidar.library.showResults')}</button>
        </div>
      </> : <>
        <p>{inCurrentDesign ? t('canvas.lidar.library.deleteBodyInDesign') : t('canvas.lidar.library.deleteBody')}</p>
        <p className={styles.muted}>{t('canvas.lidar.library.deleteOtherDesigns')}</p>
        <p className={styles.muted}>{t('canvas.lidar.library.deleteNoUndo')}</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.formActions}>
          <button type="button" className={styles.dialogButton} onClick={onKeep}>{t('canvas.lidar.library.keep')}</button>
          <button type="button" className={`${styles.dialogButton} ${styles.danger}`} disabled={busy || item.status === 'preparing' || isRunning(item)} onClick={onDelete}>
            {t('canvas.lidar.library.deleteEverywhere')}
          </button>
        </div>
      </>}
    </div>
  )
}
