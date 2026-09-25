import { DockPanelHeader } from '../shared/DockPanelHeader'
import { t } from '../../i18n'
import type { CanvasLayerPresentationDetail, CanvasLayerPresentationRow } from '../../app/canvas-layer-presentation/presentation'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import { Dropdown } from '../shared/Dropdown'
import { useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import type { BasemapStyle, SatelliteProvider } from '../../generated/contracts'
import styles from './LayerPanel.module.css'

function LayerIcon({ id }: { id: string }) {
  const path = {
    annotations: 'M4 3h8M8 3v10M5 13h6', plants: 'M8 13V7M8 10C2 10 2 4 2 4s6 0 6 6ZM8 7c0-5 6-5 6-5s0 5-6 5Z',
    'measurement-guides': 'm2 11 9-9 3 3-9 9ZM7 6l2 2M10 3l2 2M4 9l2 2', zones: 'M2 3l7-1 5 6-4 6-8-3Z',
    basemap: 'm1 4 5-2 4 2 5-2v11l-5 2-4-2-5 2ZM6 2v11M10 4v11',
    satellite: 'M3 13 13 3M5 5l6 6M2 9l3 3-2 2-3-3ZM9 2l3 3-2 2-3-3ZM11 12a3 3 0 0 0 3-3M11 15a6 6 0 0 0 4-4',
    contours: 'M1 6c4-7 8 7 14-2M1 10c4-7 8 7 14-2M1 14c4-7 8 7 14-2',
    hillshade: 'm1 13 5-9 3 5 2-3 4 7ZM6 4l3 9',
  }[id]
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
}

export function LayerVisibilityIcon({ open }: { open: boolean }) {
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
  basemapStyle?(style: BasemapStyle): void
  satelliteProvider?(provider: SatelliteProvider): void
  saveGoogleKey?(key: string | null): void
}

/**
 * `referenceItems` (the Design's LiDAR items) render inside Site references,
 * between Satellite and Contours, matching the map's band order.
 */
export function LayerPanel({ rows, actions, referenceItems }: {
  readonly rows: readonly CanvasLayerPresentationRow[]
  readonly actions: LayerPanelActions
  readonly referenceItems?: ComponentChildren
}) {

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
                  <LayerVisibilityIcon open={row.visible} />
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
              {row.id === 'satellite' && referenceItems}
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
    case 'basemap':
      return <BasemapLayerDetail row={row} detail={row.detail} actions={actions} />
    case 'satellite':
      return <SatelliteLayerDetail row={row} detail={row.detail} actions={actions} />
    case 'contours':
      return <ContourLayerDetail row={row} detail={row.detail} actions={actions} />
    case 'hillshade':
      return <HillshadeLayerDetail row={row} actions={actions} />
    case 'scene':
      return <SceneLayerDetail row={row} actions={actions} />
  }
}

function BasemapLayerDetail({ row, detail, actions }: {
  actions: LayerPanelActions
  row: CanvasLayerPresentationRow
  detail: Extract<CanvasLayerPresentationDetail, { type: 'basemap' }>
}) {
  return (
    <div className={styles.layerDetail}>
      <div className={styles.controlRow}>
        <span className={styles.controlLabel}>{t('canvas.basemap.style')}</span>
        <Dropdown
          trigger={t(`canvas.basemap.styles.${detail.style}`)}
          items={detail.styles.map((style) => ({ value: style, label: t(`canvas.basemap.styles.${style}`) }))}
          value={detail.style}
          onChange={(style) => actions.basemapStyle?.(style)}
          ariaLabel={t('canvas.basemap.style')}
          floating
        />
      </div>
      {detail.hiddenBySatellite && <p className={styles.layerNote}>{t('canvas.basemap.hiddenBySatellite')}</p>}
      <OpacitySlider actions={actions} row={row} />
    </div>
  )
}

function SatelliteLayerDetail({ row, detail, actions }: {
  actions: LayerPanelActions
  row: CanvasLayerPresentationRow
  detail: Extract<CanvasLayerPresentationDetail, { type: 'satellite' }>
}) {
  return (
    <div className={styles.layerDetail}>
      <div className={styles.controlRow}>
        <span className={styles.controlLabel}>{t('canvas.satellite.provider')}</span>
        <Dropdown
          trigger={t(`canvas.satellite.providers.${detail.provider}`)}
          items={detail.providers.map((provider) => ({ value: provider, label: t(`canvas.satellite.providers.${provider}`) }))}
          value={detail.provider}
          onChange={(provider) => actions.satelliteProvider?.(provider)}
          ariaLabel={t('canvas.satellite.provider')}
          floating
        />
      </div>
      {detail.provider === 'eox' && <p className={styles.layerNote}>{t('canvas.satellite.eoxResolution')}</p>}
      {detail.provider === 'google' && (
        <GoogleKeyForm hasKey={detail.hasGoogleKey} onSave={(key) => actions.saveGoogleKey?.(key)} />
      )}
      <OpacitySlider actions={actions} row={row} />
    </div>
  )
}

/**
 * The device-local Google key. The field never shows a stored key; saving
 * trims it, and it never reaches a Design, export, diagnostic bundle or log.
 */
function GoogleKeyForm({ hasKey, onSave }: { hasKey: boolean; onSave(key: string | null): void }) {
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState(false)
  return (
    <form
      className={styles.keyForm}
      onSubmit={(event) => {
        event.preventDefault()
        if (!draft.trim()) return
        onSave(draft)
        setDraft('')
        setSaved(true)
      }}
    >
      {!hasKey && <p className={styles.layerNote}>{t('canvas.satellite.googleKeyOptional')}</p>}
      <label className={styles.controlRow}>
        <span className={styles.controlLabel}>{t('canvas.basemap.googleKey')}</span>
        <input
          type="password"
          className={styles.keyInput}
          autoComplete="off"
          spellcheck={false}
          value={draft}
          placeholder={hasKey ? '••••••••' : ''}
          onInput={(event) => {
            setSaved(false)
            setDraft(event.currentTarget.value)
          }}
        />
      </label>
      <div className={styles.keyActions}>
        <button type="submit" className={styles.keyButton} disabled={!draft.trim()}>{t('canvas.basemap.saveKey')}</button>
        {hasKey && (
          <button
            type="button"
            className={styles.keyButton}
            onClick={() => {
              setDraft('')
              setSaved(false)
              onSave(null)
            }}
          >
            {t('canvas.basemap.clearKey')}
          </button>
        )}
      </div>
      {saved && <p className={styles.layerNote} role="status">{t('canvas.basemap.keySaved')}</p>}
      <p className={styles.layerNote}>{t('canvas.basemap.keyLocalOnly')}</p>
    </form>
  )
}

function ContourLayerDetail({ row, detail, actions }: {
  actions: LayerPanelActions
  row: CanvasLayerPresentationRow
  detail: Extract<CanvasLayerPresentationDetail, { type: 'contours' }>
}) {
  return (
    <div className={styles.layerDetail}>
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
    </div>
  )
}

function HillshadeLayerDetail({ row, actions }: {
  actions: LayerPanelActions
  row: CanvasLayerPresentationRow
}) {
  return (
    <div className={styles.layerDetail}>
      <OpacitySlider actions={actions} row={row} label={t('canvas.terrain.hillshadeOpacity')} />
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
