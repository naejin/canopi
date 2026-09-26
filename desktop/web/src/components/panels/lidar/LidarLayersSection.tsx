import { useEffect, useState } from 'preact/hooks'
import { currentDesign } from '../../../app/document-session/store'
import {
  moveReference,
  removeFromDesign,
  rerunAnalysis,
  setLidarEntryOpacity,
  setLidarEntryVisibility,
} from '../../../app/lidar/actions'
import { lidarDisplayStyle, readLidarDisplay } from '../../../app/lidar/display'
import { formatLegendValue, legendGradient } from '../../../app/lidar/display-legend'
import { itemTypeLabel } from '../../../app/lidar/item-types'
import { libraryItemName, lidarLibrary, readLidarPresentation, type LidarPresentationItem } from '../../../app/lidar/library-store'
import { analyzeInLibrary, layersFocusRequest, openDataLibrary, openInDataLibrary } from '../../../app/lidar/library-navigation'
import { viewDesignLocation, viewLidarCoverage } from '../../../app/lidar/camera-request'
import { beginInspection, endInspection, inspectionTarget } from '../../../app/lidar/inspection'
import { t } from '../../../i18n'
import { LayerVisibilityIcon } from '../../canvas/LayerPanel'
import { ButtonTooltip } from '../../shared/ButtonTooltip'
import { Notice } from '../../shared/Notice'
import { staleReasonText } from '../analyze/analysis-text'
import styles from './lidar-layers-section.module.css'

/**
 * The current Design's data band: references to library items and how this
 * Design draws them. Order, visibility and opacity are Design presentation;
 * they never change an item's source priority or values. Library management
 * lives in the Data Library, which this section links to.
 */
export function LidarLayersSection() {
  const library = lidarLibrary.value
  const design = currentDesign.value
  // Saved order is back to front; the list shows the front first, like the
  // scene stack above it.
  const items = [...readLidarPresentation(design, library)].reverse()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const selected = items.find((item) => item.id === selectedId) ?? null
  const inspecting = inspectionTarget.value
  const nameOf = (id: string) => {
    const item = library?.items.find((candidate) => candidate.id === id)
    return item ? libraryItemName(item, library) : t('canvas.lidar.library.dataUnavailable')
  }
  const refresh = (item: LidarPresentationItem) => {
    if (item.definitionId) void rerunAnalysis(item.definitionId).catch(() => {})
  }

  // The Analyze dialog can ask to show an existing result here.
  useEffect(() => {
    const request = layersFocusRequest.value
    if (!request) return
    layersFocusRequest.value = null
    setSelectedId(request)
  }, [layersFocusRequest.value])

  return (
    <section className={styles.section} aria-label={t('canvas.lidar.layers.title')}>
      <div className={styles.sectionTitle}>
        <h3>{t('canvas.lidar.layers.title')} <span>{items.length}</span></h3>
        <button type="button" className={styles.addButton} onClick={openDataLibrary}>
          {t('canvas.lidar.layers.addData')}
        </button>
      </div>
      {items.length === 0 ? (
        <div className={styles.empty}>
          <strong>{t('canvas.lidar.layers.emptyTitle')}</strong>
          <p>{t('canvas.lidar.layers.emptyBody')}</p>
          <button type="button" onClick={openDataLibrary}>{t('canvas.lidar.layers.browse')}</button>
        </div>
      ) : (
        <ul className={styles.list}>
          {items.map((item, index) => {
            const label = item.state === 'unavailable' ? t('canvas.lidar.library.unavailableItem') : item.name
            const visibilityLabel = item.visible
              ? t('canvas.lidar.layers.hide', { name: label })
              : t('canvas.lidar.layers.show', { name: label })
            const moveUpLabel = t('canvas.lidar.layers.moveUp', { name: label })
            const moveDownLabel = t('canvas.lidar.layers.moveDown', { name: label })
            return (
              <li key={`${item.kind}-${item.id}`} className={styles.layer} data-selected={selected?.id === item.id} data-hidden={!item.visible}>
                <button
                  type="button"
                  className={styles.eye}
                  aria-pressed={item.visible}
                  aria-label={visibilityLabel}
                  onClick={() => setLidarEntryVisibility(item.id, !item.visible)}
                >
                  <LayerVisibilityIcon open={item.visible} />
                  <ButtonTooltip label={visibilityLabel} side="left" />
                </button>
                <button type="button" className={styles.layerName} onClick={() => setSelectedId(item.id)}>
                  <strong>{label}</strong>
                  <small>{referenceStatus(item)}</small>
                  {isStale(item) && <small className={styles.stale}>{t('analyses.details.outOfDate')}</small>}
                </button>
                {isStale(item) && !isRefreshing(item) && (
                  <button type="button" className={styles.refresh} aria-label={t('analyses.details.refreshAria', { name: label })}
                    onClick={() => refresh(item)}>
                    {t('analyses.details.refresh')}
                  </button>
                )}
                <div className={styles.order}>
                  <button type="button" disabled={index === 0} aria-label={moveUpLabel}
                    onClick={() => moveReference(item.id, 'front')}>
                    <OrderArrow direction="up" />
                    <ButtonTooltip label={moveUpLabel} side="left" />
                  </button>
                  <button type="button" disabled={index === items.length - 1} aria-label={moveDownLabel}
                    onClick={() => moveReference(item.id, 'back')}>
                    <OrderArrow direction="down" />
                    <ButtonTooltip label={moveDownLabel} side="left" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {selected && (
        <ReferenceSettings
          item={selected}
          nameOf={nameOf}
          inspecting={inspecting?.id === selected.id}
          focused={focused}
          onFit={() => {
            if (selected.bounds && viewLidarCoverage(selected.bounds)) setFocused(true)
          }}
          onReturn={() => { viewDesignLocation(); setFocused(false) }}
          onInspect={() => {
            if (inspecting?.id === selected.id) endInspection()
            else beginInspection({ kind: selected.kind, id: selected.id, name: selected.name })
          }}
          onRemove={() => { removeFromDesign(selected.id); setSelectedId(null) }}
          onRefresh={() => refresh(selected)}
        />
      )}
    </section>
  )
}

function isStale(item: LidarPresentationItem): boolean {
  return item.state === 'Ready' && item.freshness.state === 'Stale'
}

function isRefreshing(item: LidarPresentationItem): boolean {
  return item.run?.state === 'Preparing'
}

function referenceStatus(item: LidarPresentationItem): string {
  if (item.state === 'unavailable' || !item.itemType) return t('canvas.lidar.library.dataUnavailable')
  const type = itemTypeLabel(item.itemType)
  if (item.state !== 'Ready') return `${type} · ${t('canvas.lidar.library.preparing')}`
  if (isRefreshing(item)) return `${type} · ${t('analyses.details.refreshing')}`
  const display = item.generationId ? readLidarDisplay(item.role, item.id, item.generationId) : null
  if (item.visible && display?.state === 'Preparing') return `${type} · ${t('canvas.lidar.layers.preparingDisplay')}`
  if (item.visible && display?.state === 'Failed') return `${type} · ${t('canvas.lidar.library.displayFailed')}`
  return type
}

function ReferenceSettings({ item, nameOf, inspecting, focused, onFit, onReturn, onInspect, onRemove, onRefresh }: {
  item: LidarPresentationItem
  nameOf(id: string): string
  inspecting: boolean
  focused: boolean
  onFit(): void
  onReturn(): void
  onInspect(): void
  onRemove(): void
  onRefresh(): void
}) {
  const available = item.state === 'Ready'
  const style = lidarDisplayStyle(item)
  const percent = Math.round(item.opacity * 100)
  return (
    <div className={styles.settings}>
      <h4>{item.state === 'unavailable' ? t('canvas.lidar.library.unavailableItem') : item.name}</h4>
      {isStale(item) && item.freshness.state === 'Stale' && (
        <Notice
          tone="warning"
          action={!isRefreshing(item) && <button type="button" onClick={onRefresh}>{t('analyses.details.refresh')}</button>}
        >
          <strong>{t('analyses.details.outOfDate')}</strong>
          <ul className={styles.reasons}>
            {item.freshness.reasons.map((reason, index) => <li key={index}>{staleReasonText(reason, nameOf)}</li>)}
          </ul>
        </Notice>
      )}
      <label>
        <span>{t('canvas.lidar.layers.opacity')}</span>
        <output>{percent}%</output>
        <input
          type="range"
          min="0"
          max="100"
          value={percent}
          aria-label={t('canvas.lidar.layers.opacity')}
          onInput={(event) => setLidarEntryOpacity(item.id, Number(event.currentTarget.value) / 100)}
        />
      </label>
      {available && (
        <div className={styles.legend} aria-label={t('canvas.lidar.layers.legend')}>
          <div className={styles.ramp} style={{ backgroundImage: legendGradient(style.colormap, style.reversed) }} />
          <div className={styles.legendLabels}>
            <span>{formatLegendValue(style.rescale[0], style.units)}</span>
            <span>{formatLegendValue(style.rescale[1], style.units)}</span>
          </div>
        </div>
      )}
      <div className={styles.actions}>
        {focused
          ? <button type="button" onClick={onReturn}>{t('canvas.lidar.layers.returnToDesign')}</button>
          : <button type="button" disabled={!available || !item.bounds} onClick={onFit}>{t('canvas.lidar.layers.fit')}</button>}
        <button
          type="button"
          aria-pressed={inspecting}
          disabled={!available || !item.visible}
          onClick={onInspect}
        >
          {t('canvas.lidar.layers.inspect')}
        </button>
        {item.role === 'Source' && available && (
          <button type="button" onClick={() => analyzeInLibrary(item.id)}>
            {t('canvas.lidar.library.analyze')}
          </button>
        )}
      </div>
      {item.state !== 'unavailable' && (
        <button type="button" className={styles.linkButton} onClick={() => openInDataLibrary(item.id)}>
          {t('canvas.lidar.layers.openInLibrary')}
        </button>
      )}
      <button type="button" className={styles.remove} onClick={onRemove}>
        {t('canvas.lidar.layers.removeFromDesign')}
      </button>
    </div>
  )
}

function OrderArrow({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d={direction === 'up' ? 'M6 10V2M2.5 5.5 6 2l3.5 3.5' : 'M6 2v8M2.5 6.5 6 10l3.5-3.5'}
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}
