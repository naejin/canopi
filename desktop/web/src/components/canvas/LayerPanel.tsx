import { DockPanelHeader } from '../shared/DockPanelHeader'
import { t } from '../../i18n'
import type { CanvasLayerPresentationDetail, CanvasLayerPresentationRow } from '../../app/canvas-layer-presentation/presentation'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import styles from './LayerPanel.module.css'

function LayerIcon({ id }: { id: string }) {
  const path = {
    annotations: 'M4 3h8M8 3v10M5 13h6', plants: 'M8 13V7M8 10C2 10 2 4 2 4s6 0 6 6ZM8 7c0-5 6-5 6-5s0 5-6 5Z',
    'measurement-guides': 'm2 11 9-9 3 3-9 9ZM7 6l2 2M10 3l2 2M4 9l2 2', zones: 'M2 3l7-1 5 6-4 6-8-3Z',
    base: 'm1 4 5-2 4 2 5-2v11l-5 2-4-2-5 2ZM6 2v11M10 4v11',
    contours: 'M1 6c4-7 8 7 14-2M1 10c4-7 8 7 14-2M1 14c4-7 8 7 14-2',
    hillshading: 'm1 13 5-9 3 5 2-3 4 7ZM6 4l3 9',
  }[id]
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.2 8C1.2 8 3.7 3.5 8 3.5C12.3 3.5 14.8 8 14.8 8C14.8 8 12.3 12.5 8 12.5C3.7 12.5 1.2 8 1.2 8Z"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
      {open ? <circle cx="8" cy="8" r="2.2" fill="currentColor" /> : <path d="M2 2L14 14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />}
    </svg>
  )
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4" y="7" width="8" height="6.2" rx="1.2" stroke="currentColor" stroke-width="1.3" />
      {locked ? (
        <path
          d="M5.8 7V5.4C5.8 4.1 6.8 3.1 8 3.1C9.2 3.1 10.2 4.1 10.2 5.4V7"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
      ) : (
        <path
          d="M5.8 7V5.4C5.8 4.1 6.8 3.1 8 3.1C9 3.1 9.8 3.8 10.1 4.7"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
      )}
      <path d="M8 9.2V11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  )
}

export interface LayerPanelActions {
  active(id: string): void
  visibility(id: string, visible: boolean): void
  locked(id: string, locked: boolean): void
  opacity(id: string, opacity: number): void
  contourInterval?(meters: number): void
  location?(): void
}

export function LayerPanel({ rows, actions }: { readonly rows: readonly CanvasLayerPresentationRow[]; readonly actions: LayerPanelActions }) {

  const active = rows.find(row => row.active)
  const firstReference = rows.find(row => row.detail.type !== 'scene')?.id
  return (
    <aside className={styles.panel} aria-label={t('canvas.layers.layerPanel')}>
      <DockPanelHeader title={t('canvas.layers.layerPanel')} count={rows.length} />
      <div className={styles.groupHeading}><h3>{t('canvas.layers.sceneStack')}</h3><span>{t('canvas.layers.topToBottom')}</span></div>
      <div role="list">
        {rows.map((row) => {
          const lockLabel = row.locked ? t('canvas.layers.unlockLayer') : t('canvas.layers.lockLayer')
          return (
            <div key={row.id}>
              {row.id === firstReference && <div className={styles.groupHeading}><h3>{t('canvas.layers.references')}</h3></div>}
              <div
                role="listitem"
                className={styles.layerRow}
                data-active={row.active ? 'true' : 'false'}
                data-hidden={row.visible ? 'false' : 'true'}
                data-locked={row.locked ? 'true' : 'false'}
              >
                <button
                  type="button"
                  className={styles.toggleBtn}
                  aria-label={`${t('canvas.layers.visibility')}: ${row.label}`}
                  aria-pressed={row.visible}
                  onClick={() => {
                    actions.visibility(row.id, !row.visible)
                  }}
                >
                  <EyeIcon open={row.visible} />
                  <ButtonTooltip label={`${t('canvas.layers.visibility')}: ${row.label}`} side="left" />
                </button>
                <button
                  type="button"
                  className={styles.layerName}
                  aria-current={row.active ? 'true' : undefined}
                  title={row.label}
                  onClick={() => actions.active(row.id)}
                >
                  <LayerIcon id={row.id} /><span>{row.label}</span>
                  {row.count !== undefined && <span className={styles.count}>{row.count}</span>}
                </button>
                {row.canLock ? (
                  <button
                    type="button"
                    className={styles.lockBtn}
                    aria-label={`${lockLabel}: ${row.label}`}
                    aria-pressed={row.locked}
                    onClick={() => {
                      actions.locked(row.id, !row.locked)
                    }}
                  >
                    <LockIcon locked={row.locked} />
                    <ButtonTooltip label={lockLabel} side="left" />
                  </button>
                ) : (
                  <span className={styles.lockSlot} aria-hidden="true" />
                )}
              </div>

            </div>
          )
        })}
      </div>
      {firstReference && <p className={styles.referenceHint}>{t('canvas.layers.referenceOrder')}</p>}
      {active && <section className={styles.inspector} aria-label={active.label}>
        <div className={styles.inspectorHeading}><LayerIcon id={active.id} /><h3>{active.label}</h3>
          <span>{t(active.visible ? 'canvas.layers.visible' : 'canvas.layers.hidden')}{active.canLock && ` · ${t(active.locked ? 'canvas.layers.locked' : 'canvas.layers.unlocked')}`}</span></div>
        <LayerDetail row={active} actions={actions} />
      </section>}
    </aside>
  )
}

function LayerDetail({ row, actions }: { row: CanvasLayerPresentationRow; actions: LayerPanelActions }) {
  switch (row.detail.type) {
    case 'location-map':
      return <LocationLayerDetail row={row} detail={row.detail} actions={actions} />
    case 'contours':
      return <ContourLayerDetail row={row} detail={row.detail} actions={actions} />
    case 'hillshade':
      return <HillshadeLayerDetail row={row} detail={row.detail} actions={actions} />
    case 'scene':
      return <SceneLayerDetail row={row} actions={actions} />
  }
}

function DesignLocationButton({ actions }: { actions: LayerPanelActions }) {
  if (!actions.location) return null
  return <button type="button" className={styles.locationActionButton} onClick={actions.location}>{t('canvas.location.title')}</button>
}

function LocationLayerDetail({ row, detail, actions }: {
  actions: LayerPanelActions
  row: CanvasLayerPresentationRow
  detail: Extract<CanvasLayerPresentationDetail, { type: 'location-map' }>
}) {
  return (
    <div className={styles.layerDetail}>
      {detail.hasLocation ? (
        <>
          <div className={styles.locationCard} data-has-location="true">
            <span className={styles.locationCardLabel}>{t('canvas.location.current')}</span>
            <span className={styles.locationCardText}>{detail.locationSummary}</span>
          </div>
          <OpacitySlider actions={actions} row={row} disabled={detail.opacityDisabled} />
        </>
      ) : (
        <DesignLocationButton actions={actions} />
      )}
    </div>
  )
}

function ContourLayerDetail({ row, detail, actions }: {
  actions: LayerPanelActions
  row: CanvasLayerPresentationRow
  detail: Extract<CanvasLayerPresentationDetail, { type: 'contours' }>
}) {
  return (
    <div className={styles.layerDetail}>
      {detail.hasLocation ? (
        <>
          <OpacitySlider actions={actions} row={row} />
          <div className={styles.controlRow}>
            <span className={styles.controlLabel}>{t('canvas.terrain.contourInterval')}</span>
            <input
              type="number"
              min="0"
              step="1"
              className={styles.numericInput}
              value={String(detail.contourIntervalMeters)}
              aria-label={t('canvas.terrain.contourInterval')}
              onInput={(event) => {
                const raw = event.currentTarget.value
                const value = Number(raw)
                if (raw.trim() && Number.isFinite(value) && value >= 0) actions.contourInterval?.(value)
              }}
            />
          </div>
        </>
      ) : (
        <DesignLocationButton actions={actions} />
      )}
    </div>
  )
}

function HillshadeLayerDetail({ row, detail, actions }: {
  actions: LayerPanelActions
  row: CanvasLayerPresentationRow
  detail: Extract<CanvasLayerPresentationDetail, { type: 'hillshade' }>
}) {
  return (
    <div className={styles.layerDetail}>
      {detail.hasLocation ? (
        <OpacitySlider actions={actions} row={row} label={t('canvas.terrain.hillshadeOpacity')} />
      ) : (
        <DesignLocationButton actions={actions} />
      )}
    </div>
  )
}

function SceneLayerDetail({ row, actions }: { row: CanvasLayerPresentationRow; actions: LayerPanelActions }) {
  return (
    <div className={styles.layerDetail}>
      <OpacitySlider actions={actions} row={row} />
    </div>
  )
}

function OpacitySlider({ row, disabled, actions, label }: { row: CanvasLayerPresentationRow; disabled?: boolean; actions: LayerPanelActions; label?: string }) {
  const opacity = Math.round(row.opacity * 100)
  return (
    <div className={styles.controlRow}>
      <span className={styles.controlLabel}>
        {label ?? t('canvas.layers.opacity')}
        <output className={styles.opacityValue}>{opacity}%</output>
      </span>
      <input
        type="range"
        className={styles.mapSlider}
        min="0"
        max="100"
        value={opacity}
        aria-label={label ?? `${t('canvas.layers.opacity')}: ${row.label}`}
        disabled={disabled}
        onInput={(event) => {
          actions.opacity(row.id, Number((event.target as HTMLInputElement).value) / 100)
        }}
      />
    </div>
  )
}
