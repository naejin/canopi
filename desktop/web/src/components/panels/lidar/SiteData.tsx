import { designSessionStore, currentDesign } from '../../../app/document-session/store'
import {
  addToDesign,
  attachmentFailure,
  cancelAnalysisJob,
  cancelLibraryImport,
  dismissAttachmentFailure,
  moveReference,
  pendingAttachments,
  removeFromDesign,
  rerunAnalysis,
  setLidarEntryDisplay,
  setLidarEntryVisibility,
} from '../../../app/lidar/actions'
import { siteDataLines } from '../../../app/lidar/analysis-groups'
import { lidarDisplayStyle, readLidarDisplay } from '../../../app/lidar/display'
import { analysisTitle, findAnalysis } from '../../../app/analyses/registry'
import { formatLegendValue, formatRasterRange, legendGradient } from '../../../app/lidar/display-legend'
import { itemTypeLabel } from '../../../app/lidar/item-types'
import { libraryItems } from '../../../app/lidar/library-items'
import {
  activeSiteItemId,
  analyzeItem,
  beginDataImport,
  openDataLibrary,
  openSiteDataDetails,
  selectSiteRow,
} from '../../../app/lidar/library-navigation'
import { isMissing, libraryItemName, lidarLibrary, readCurrentLidarPresentation, type LidarPresentationItem } from '../../../app/lidar/library-store'
import { canMoveReference, referenceRows, type ReferenceRow } from '../../../app/lidar/reference-tree'
import { viewDesignLocation, viewLidarCoverage } from '../../../app/lidar/camera-request'
import { locale } from '../../../app/settings/state'
import type { LibraryItemSummary } from '../../../generated/contracts'
import { t } from '../../../i18n'
import { ActionMenu, type ActionMenuEntry } from '../../shared/ActionMenu'
import { ButtonTooltip } from '../../shared/ButtonTooltip'
import { ControlIcon } from '../../shared/ControlIcon'
import { LayerVisibilityIcon } from '../../shared/LayerVisibilityIcon'
import layerRow from '../../shared/layer-row.module.css'
import { Notice } from '../../shared/Notice'
import { Slider } from '../../shared/Slider'
import { staleReasonText } from '../analyze/analysis-text'
import { unitWords } from './item-text'
import styles from './site-data.module.css'
import { useState } from 'preact/hooks'

type SiteRow = ReferenceRow<LidarPresentationItem>

/** The Design's site data rows in Layers: front first, results under their source. */
function readSiteRows(): SiteRow[] {
  return referenceRows(readCurrentLidarPresentation())
}

function nameOfItem(id: string): string {
  const library = lidarLibrary.value
  const item = library?.items.find((candidate) => candidate.id === id)
  return item ? libraryItemName(item, library) : t('canvas.lidar.library.dataUnavailable')
}

function rowLabel(item: LidarPresentationItem): string {
  return isMissing(item) ? t('canvas.lidar.library.unavailableItem') : item.name
}

/**
 * "Add data": the one entry point for site data. Files open the native picker
 * then Import (the item joins this Design once published); Design objects
 * from GeoJSON run the File › Import GeoJSON command; library items are added
 * directly; the Data library opens for everything else.
 */
export function AddDataMenu({ importGeoJson }: { readonly importGeoJson: () => void }) {
  const library = libraryItems(lidarLibrary.value).filter((item) => item.status === 'ready')
  const inDesign = new Set((currentDesign.value?.lidar?.entries ?? []).map((entry) => entry.id))
  const fromLibrary: ActionMenuEntry[] = library.length === 0
    ? [{ label: t('canvas.lidar.layers.libraryEmpty'), disabled: true, run: () => {} }]
    : library.map((item) => ({
      label: inDesign.has(item.id) ? t('canvas.lidar.layers.inThisDesign', { name: item.name }) : item.name,
      disabled: inDesign.has(item.id),
      run: () => {
        addToDesign(item.role, item.id)
        selectSiteRow(item.id)
      },
    }))
  return (
    <ActionMenu
      label={t('canvas.lidar.layers.addData')}
      triggerLabel={<span>{t('canvas.lidar.layers.addData')}</span>}
      triggerIcon="plus"
      triggerClassName={styles.addTrigger}
      iconSize={18}
      items={[
        { label: t('canvas.lidar.layers.fromFiles'), opensDialog: true, run: () => { void beginDataImport() } },
        { label: t('canvas.lidar.layers.fromGeoJson'), opensDialog: true, run: importGeoJson },
        { label: t('canvas.lidar.layers.fromLibrary'), submenu: fromLibrary },
        { separator: true },
        { label: t('canvas.lidar.layers.openLibrary'), opensDialog: true, run: () => openDataLibrary() },
      ]}
    />
  )
}

/**
 * The Design's site data: its terrain and height items with the results
 * calculated from them nested underneath, and imports or calculations started
 * from Layers that will join it. Order, visibility and opacity are Design
 * presentation; they never change an item's values or source priority.
 */
export function SiteDataRows() {
  const rows = readSiteRows()
  const active = activeSiteItemId()
  const identity = designSessionStore.sessionIdentity.value
  const pending = pendingAttachments.value.filter((entry) => entry.identity === identity)
  const snapshot = lidarLibrary.value
  const failure = attachmentFailure.value

  return (
    <div className={styles.band}>
      {rows.length === 0 && pending.length === 0 && (
        <div className={styles.empty}>
          <strong>{t('canvas.lidar.layers.emptyTitle')}</strong>
          <p>{t('canvas.lidar.layers.emptyBody')}</p>
          <div className={styles.emptyActions}>
            <button type="button" onClick={() => { void beginDataImport() }}>{t('canvas.lidar.layers.emptyImport')}</button>
            <button type="button" onClick={() => openDataLibrary()}>{t('canvas.lidar.layers.emptyLibrary')}</button>
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <ul className={styles.list}>
          {siteDataLines(rows).map((line) => line.kind === 'analysis'
            ? <AnalysisGroupRow key={`analysis:${line.definitionId}`} members={line.members} depth={line.depth} />
            : <SiteDataRow key={line.row.id} row={line.row} depth={line.depth} grouped={line.grouped} active={line.row.id === active} />)}
        </ul>
      )}
      {pending.map((entry) => {
        const items = entry.itemIds
          .map((id) => snapshot?.items.find((candidate) => candidate.id === id))
          .filter((item): item is LibraryItemSummary => item !== undefined)
        return items.length > 0 ? <PendingRow key={entry.key} kind={entry.kind} items={items} /> : null
      })}
      {failure && (
        <Notice
          tone="warning"
          action={<>
            <button type="button" className={styles.noticeButton} onClick={() => { dismissAttachmentFailure(); openDataLibrary(failure.itemId) }}>
              {t('canvas.lidar.layers.showInLibrary')}
            </button>
            <button type="button" className={styles.noticeButton} onClick={dismissAttachmentFailure}>{t('canvas.lidar.library.dismiss')}</button>
          </>}
        >
          {failure.message
            ? t('canvas.lidar.layers.failed', { name: nameOfItem(failure.itemId), message: failure.message })
            : t('canvas.lidar.layers.failedNoMessage', { name: nameOfItem(failure.itemId) })}
        </Notice>
      )}
    </div>
  )
}

/**
 * The parent line of an analysis with several outputs in this Design: its
 * title, where it comes from and how many results it has. Its eye shows or
 * hides every output; each output keeps its own row, settings and order.
 */
function AnalysisGroupRow({ members, depth }: { members: readonly SiteRow[]; depth: number }) {
  const first = members[0]!
  const label = first.analysisId ? analysisTitle(first.analysisId) : rowLabel(first)
  const visible = members.some((member) => member.visible)
  const visibilityLabel = visible
    ? t('canvas.lidar.layers.hide', { name: label })
    : t('canvas.lidar.layers.show', { name: label })
  const caption = [
    first.inputId ? t('canvas.lidar.layers.fromItem', { name: nameOfItem(first.inputId) }) : null,
    t('canvas.lidar.layers.resultCount', { count: members.length }),
  ].filter(Boolean).join(' · ')
  return (
    <li className={`${layerRow.row} ${styles.row}`} data-hidden={!visible} data-depth={Math.min(depth, 3)} data-analysis-group>
      <button
        type="button"
        className={layerRow.eye}
        aria-pressed={visible}
        aria-label={visibilityLabel}
        onClick={() => { for (const member of members) setLidarEntryVisibility(member.id, !visible) }}
      >
        <LayerVisibilityIcon open={visible} />
        <ButtonTooltip label={visibilityLabel} side="left" />
      </button>
      <span className={styles.groupName}>
        <strong>{label}</strong>
        <small>{caption}</small>
      </span>
    </li>
  )
}

function SiteDataRow({ row, depth, grouped, active }: { row: SiteRow; depth: number; grouped: boolean; active: boolean }) {
  const label = rowLabel(row)
  const visibilityLabel = row.visible
    ? t('canvas.lidar.layers.hide', { name: label })
    : t('canvas.lidar.layers.show', { name: label })
  return (
    <li
      className={`${layerRow.row} ${styles.row}`}
      data-hidden={!row.visible}
      data-depth={Math.min(depth, 3)}
    >
      <button
        type="button"
        className={layerRow.eye}
        aria-pressed={row.visible}
        aria-label={visibilityLabel}
        onClick={() => setLidarEntryVisibility(row.id, !row.visible)}
      >
        <LayerVisibilityIcon open={row.visible} />
        <ButtonTooltip label={visibilityLabel} side="left" />
      </button>
      <button
        type="button"
        className={`${layerRow.name} ${styles.name}`}
        aria-expanded={active}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        onClick={() => selectSiteRow(row.id)}
        onKeyDown={(event) => {
          if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
          event.preventDefault()
          moveReference(row.id, event.key === 'ArrowUp' ? 'front' : 'back')
        }}
      >
        <strong>{label}</strong>
        <small>{rowCaption(row, grouped)}</small>
      </button>
      {isStale(row) && (
        isRefreshing(row)
          ? <span className={styles.badge}>{t('analyses.details.refreshing')}</span>
          : (
            <button type="button" className={styles.stale} aria-label={t('analyses.details.refreshAria', { name: label })}
              onClick={() => refresh(row)}>
              {t('analyses.details.outOfDate')} · {t('analyses.details.refresh')}
            </button>
          )
      )}
    </li>
  )
}

function PendingRow({ kind, items }: { kind: 'import' | 'analysis'; items: readonly LibraryItemSummary[] }) {
  const first = items[0]!
  const name = libraryItemName(first, lidarLibrary.value)
  const percent = kind === 'import' ? first.import_job?.progress?.percent : undefined
  const status = kind === 'import'
    ? t('canvas.lidar.layers.importing')
    : t('canvas.lidar.library.calculating')
  return (
    <div className={styles.pending} role="group" aria-label={name}>
      <div className={styles.pendingHead}>
        <strong>{name}</strong>
        <span>{percent !== undefined ? `${status} · ${new Intl.NumberFormat(locale.value, { style: 'percent' }).format(percent / 100)}` : status}</span>
      </div>
      <progress
        max={100}
        value={percent}
        aria-label={kind === 'import'
          ? t('canvas.lidar.library.progressAria', { name })
          : t('canvas.lidar.layers.calculationAria', { name })}
      />
      <div className={styles.pendingActions}>
        {kind === 'import'
          ? first.import_job && (
            <button type="button" onClick={() => { void cancelLibraryImport(first.import_job!.job_id).catch(() => {}) }}>
              {t('canvas.lidar.layers.cancelImport')}
            </button>
          )
          : (
            <button type="button" onClick={() => { void cancelAnalysisJob(first).catch(() => {}) }}>
              {t('canvas.lidar.layers.cancelCalculation')}
            </button>
          )}
        <span>{t('canvas.lidar.layers.keepWorking')}</span>
      </div>
    </div>
  )
}

function isStale(item: LidarPresentationItem): boolean {
  return item.state === 'Ready' && item.freshness.state === 'Stale'
}

function isRefreshing(item: LidarPresentationItem): boolean {
  return item.run?.state === 'Preparing'
}

function refresh(item: LidarPresentationItem): void {
  if (item.definitionId) void rerunAnalysis(item.definitionId).catch(() => {})
}

/**
 * What a row is: a source's type and range, or where a result comes from;
 * under its analysis line, which output it is. Preparing and failing display
 * states follow.
 */
function rowCaption(item: LidarPresentationItem, grouped: boolean): string {
  if (item.availability !== 'present' || !item.itemType) return t('canvas.lidar.library.dataUnavailable')
  const output = grouped && item.analysisId
    ? findAnalysis(item.analysisId)?.outputs.find((candidate) => candidate.key === item.outputKey)
    : undefined
  const what = output
    ? [t(output.labelKey), unitWords(item.units)].filter(Boolean).join(' · ')
    : item.inputId
    ? [t('canvas.lidar.layers.fromItem', { name: nameOfItem(item.inputId) }), unitWords(item.units)].filter(Boolean).join(' · ')
    : [itemTypeLabel(item.itemType), item.displayRange ? formatRasterRange(item.displayRange, item.units, locale.value) : null]
      .filter(Boolean).join(' · ')
  if (item.state !== 'Ready') return `${what} · ${t('canvas.lidar.library.preparing')}`
  const display = item.generationId ? readLidarDisplay(item.kind, item.id, item.generationId) : null
  if (item.shown && display?.state === 'Preparing') return `${what} · ${t('canvas.lidar.layers.preparingDisplay')}`
  if (item.shown && display?.state === 'Failed') return `${what} · ${t('canvas.lidar.library.displayFailed')}`
  return what
}

/**
 * The active site data row's settings, at the foot of Site data: legend,
 * opacity, Fit, Analyze (sources), Details, order and Remove from Design. Removing only edits this Design; the library keeps the data.
 */
export function SiteDataInspector() {
  const id = activeSiteItemId()
  const rows = readSiteRows()
  const item = id ? rows.find((row) => row.id === id) ?? null : null
  const [focused, setFocused] = useState(false)
  if (!item) return null
  const label = rowLabel(item)
  const available = item.state === 'Ready'
  const style = lidarDisplayStyle(item)
  const moveFront = t('canvas.lidar.layers.moveUp', { name: label })
  const moveBack = t('canvas.lidar.layers.moveDown', { name: label })
  return (
    <section className={styles.inspector} aria-label={label}>
      <div className={styles.inspectorHead}>
        <h3>{label}</h3>
        <span>{item.itemType ? itemTypeLabel(item.itemType) : t('canvas.lidar.library.dataUnavailable')}</span>
      </div>
      {isStale(item) && item.freshness.state === 'Stale' && (
        <Notice
          tone="warning"
          action={!isRefreshing(item) && <button type="button" className={styles.noticeButton} onClick={() => refresh(item)}>{t('analyses.details.refresh')}</button>}
        >
          <strong>{t('analyses.details.outOfDate')}</strong>
          <ul className={styles.reasons}>
            {item.freshness.reasons.map((reason, index) => <li key={index}>{staleReasonText(reason, nameOfItem)}</li>)}
          </ul>
        </Notice>
      )}
      {available && (
        <div className={styles.legend} aria-label={t('canvas.lidar.layers.legend')}>
          <div className={styles.ramp} style={{ backgroundImage: legendGradient(style.colormap, style.reversed) }} />
          <div className={styles.legendLabels}>
            <span>{formatLegendValue(style.rescale[0], style.units, locale.value)}</span>
            <span>{formatLegendValue(style.rescale[1], style.units, locale.value)}</span>
          </div>
        </div>
      )}
      <Slider
        label={t('canvas.lidar.layers.opacity')}
        ariaLabel={`${t('canvas.lidar.layers.opacity')}: ${label}`}
        min={0}
        max={100}
        value={Math.round(item.opacity * 100)}
        format={(value) => new Intl.NumberFormat(locale.value, { style: 'percent' }).format(value / 100)}
        onInput={(value) => setLidarEntryDisplay(item.id, { opacity: value / 100 })}
      />
      <div className={styles.actions}>
        {focused
          ? <button type="button" onClick={() => { viewDesignLocation(); setFocused(false) }}>{t('canvas.lidar.layers.returnToDesign')}</button>
          : (
            <button type="button" disabled={!available || !item.bounds}
              onClick={() => { if (item.bounds && viewLidarCoverage(item.bounds)) setFocused(true) }}>
              {t('canvas.lidar.layers.fit')}
            </button>
          )}
        {item.kind === 'Source' && available && (
          <button type="button" onClick={() => analyzeItem(item.id, { attach: true })}>
            {t('canvas.lidar.library.analyze')}
          </button>
        )}
        {item.availability === 'present' && (
          <button type="button" onClick={() => openSiteDataDetails(item.id)}>{t('canvas.lidar.layers.details')}</button>
        )}
        <span className={styles.order}>
          <button type="button" className={styles.iconButton} aria-label={moveFront}
            disabled={!canMoveReference(rows, item.id, 'front')} onClick={() => moveReference(item.id, 'front')}>
            <ControlIcon name="chevron-down" className={styles.flip} />
            <ButtonTooltip label={moveFront} side="left" />
          </button>
          <button type="button" className={styles.iconButton} aria-label={moveBack}
            disabled={!canMoveReference(rows, item.id, 'back')} onClick={() => moveReference(item.id, 'back')}>
            <ControlIcon name="chevron-down" />
            <ButtonTooltip label={moveBack} side="left" />
          </button>
        </span>
      </div>
      <div className={styles.remove}>
        <button
          type="button"
          className={styles.link}
          aria-label={t('canvas.lidar.layers.removeAria', { name: label })}
          onClick={() => removeFromDesign(item.id)}
        >
          {t('canvas.lidar.layers.removeFromDesign')}
        </button>
        <span>{t('canvas.lidar.layers.removeKeeps')}</span>
      </div>
    </section>
  )
}
