import { DockPanelHeader } from '../shared/DockPanelHeader'
import { t } from '../../i18n'
import { locale } from '../../app/settings/state'
import { formatCount } from '../../utils/format-count'
import type { CanvasLayerPresentationDetail, CanvasLayerPresentationRow } from '../../app/canvas-layer-presentation/presentation'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import { Dropdown } from '../shared/Dropdown'
import { useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import type { BasemapStyle } from '../../generated/contracts'
import type { MapBackground } from '../../app/map-layers/state'
import { Switch } from '../shared/Switch'
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
  saveGoogleKey?(key: string | null): void
  /** Background › Satellite, Map or None. */
  background?(choice: MapBackground): void
  /** Soften background: dims the chosen background under the Design. */
  softenBackground?(soften: boolean): void
}

/** Background sources are proper names, the same in every language. */
const BACKGROUND_SOURCES = { satellite: 'Google', basemap: 'OpenFreeMap' } as const

/** Which background the map draws: Satellite hides the Basemap under it. */
function chosenBackground(background: readonly CanvasLayerPresentationRow[]): MapBackground {
  if (background.find((row) => row.id === 'satellite')?.visible) return 'satellite'
  return background.find((row) => row.id === 'basemap')?.visible ? 'basemap' : 'none'
}

/**
 * The Layers panel of both editions, front to back in three sections: the
 * Design's own objects, its site data, and the background (one choice of
 * Satellite, Map or None; the chosen one's settings show in the footer). `siteData` is the
 * edition's part of Site data (Desktop: the Design's terrain and height items
 * with their results; Web: why they are not shown) and `siteAction` its Add
 * data entry. The online-elevation terrain rows follow, nested under the
 * source they come from. The footer shows the active row's settings, or
 * `siteFooter` when the active row is a site data item.
 */
export function LayerPanel({ rows, actions, siteData, siteAction, siteFooter }: {
  readonly rows: readonly CanvasLayerPresentationRow[]
  readonly actions: LayerPanelActions
  readonly siteData?: ComponentChildren
  readonly siteAction?: ComponentChildren
  readonly siteFooter?: ComponentChildren
}) {
  const inGroup = (group: CanvasLayerPresentationRow['group']) => rows.filter((row) => row.group === group)
  const terrain = inGroup('site')
  const background = inGroup('background')
  const choice = chosenBackground(background)
  // A background that is not drawn has no settings to show.
  const active = rows.find(row => row.active && (row.group !== 'background' || row.id === choice))
  const footer = active
    ? (
      <section className={styles.inspector} aria-label={active.label}>
        <div className={styles.inspectorHeading}><LayerIcon id={active.id} /><h3>{active.label}</h3>
          <span>{t(active.visible ? 'canvas.layers.visible' : 'canvas.layers.hidden')}{active.canLock && ` · ${t(active.locked ? 'canvas.layers.locked' : 'canvas.layers.unlocked')}`}</span></div>
        <LayerDetail row={active} actions={actions} />
      </section>
    )
    : siteFooter
  return (
    <aside className={styles.panel} aria-label={t('canvas.layers.layerPanel')}>
      <DockPanelHeader title={t('canvas.layers.layerPanel')} />
      <div className={styles.scroll}>
        <section className={styles.section} aria-labelledby="layers-design">
          <div className={styles.groupHeading}><h3 id="layers-design">{t('canvas.layers.design')}</h3></div>
          <div role="list">{inGroup('design').map((row) => <LayerRow key={row.id} row={row} actions={actions} />)}</div>
        </section>
        {(siteData || terrain.length > 0) && (
          <section className={styles.section} aria-labelledby="layers-site">
            <div className={styles.groupHeading}><h3 id="layers-site">{t('canvas.layers.siteData')}</h3>{siteAction}</div>
            {siteData}
            {terrain.length > 0 && <>
              <div className={styles.sourceHeading}>
                <strong>{t('canvas.terrain.onlineElevation')}</strong>
                <span>{t('canvas.terrain.onlineElevationNote')}</span>
              </div>
              <div role="list">
                {terrain.map((row) => <LayerRow key={row.id} row={row} actions={actions} nested caption={terrainCaption(row)} />)}
              </div>
            </>}
          </section>
        )}
        {background.length > 0 && (
          <section className={styles.section} aria-labelledby="layers-background">
            <div className={styles.groupHeading}><h3 id="layers-background">{t('canvas.layers.background')}</h3></div>
            <BackgroundChoice rows={background} choice={choice} actions={actions} />
          </section>
        )}
      </div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </aside>
  )
}

/**
 * Background as one choice: Satellite, Map or None. Choosing Satellite or Map
 * (or choosing it again) shows its settings in the footer: opacity, Soften
 * background, and the map style or satellite key.
 */
function BackgroundChoice({ rows, choice, actions }: {
  readonly rows: readonly CanvasLayerPresentationRow[]
  readonly choice: MapBackground
  readonly actions: LayerPanelActions
}) {
  const options: { value: MapBackground; label: string; source: string; row?: CanvasLayerPresentationRow }[] = [
    { value: 'satellite', label: t('canvas.layers.satellite'), source: BACKGROUND_SOURCES.satellite, row: rows.find((row) => row.id === 'satellite') },
    { value: 'basemap', label: t('canvas.layers.backgroundMap'), source: BACKGROUND_SOURCES.basemap, row: rows.find((row) => row.id === 'basemap') },
    { value: 'none', label: t('canvas.layers.backgroundNone'), source: t('canvas.layers.backgroundPlainPaper') },
  ]
  return (
    <div role="radiogroup" aria-labelledby="layers-background" className={styles.backgroundChoice}>
      {options.filter((option) => option.value === 'none' || option.row).map((option) => (
        <label
          key={option.value}
          className={styles.backgroundOption}
          data-active={option.row?.active && option.value === choice ? 'true' : 'false'}
        >
          <input
            type="radio"
            name="layers-background"
            value={option.value}
            checked={option.value === choice}
            onChange={() => {
              actions.background?.(option.value)
              if (option.row) actions.active(option.row.id)
            }}
            onClick={() => {
              // Choosing the current background again brings back its settings.
              if (option.value === choice && option.row) actions.active(option.row.id)
            }}
          />
          <span className={styles.nameText}>
            <span>{option.label}</span>
            <small className={styles.caption}>{option.source}</small>
          </span>
        </label>
      ))}
    </div>
  )
}

/** Contour lines and hillshading say which elevation they are drawn from. */
function terrainCaption(row: CanvasLayerPresentationRow): string {
  if (row.detail.type === 'contours') {
    return row.detail.contourIntervalMeters > 0
      ? t('canvas.terrain.contoursEvery', {
        interval: new Intl.NumberFormat(locale.value).format(row.detail.contourIntervalMeters),
      })
      : t('canvas.terrain.contoursByZoom')
  }
  return t('canvas.terrain.fromOnlineElevation')
}

function LayerRow({ row, actions, nested = false, caption }: {
  readonly row: CanvasLayerPresentationRow
  readonly actions: LayerPanelActions
  readonly nested?: boolean
  readonly caption?: string
}) {
  const lockLabel = row.locked ? t('canvas.layers.unlockLayer') : t('canvas.layers.lockLayer')
  return (
    <div
      role="listitem"
      className={styles.layerRow}
      data-active={row.active ? 'true' : 'false'}
      data-hidden={row.visible ? 'false' : 'true'}
      data-locked={row.locked ? 'true' : 'false'}
      data-nested={nested ? 'true' : undefined}
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
        <LayerIcon id={row.id} />
        <span className={styles.nameText}>
          <span>{row.label}</span>
          {caption && <small className={styles.caption}>{caption}</small>}
        </span>
        {row.count !== undefined && <span className={styles.count}>{formatCount(row.count, locale.value)}</span>}
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
      <OpacitySlider actions={actions} row={row} />
      <SoftenBackgroundSwitch soften={detail.softenBackground} actions={actions} />
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
      <GoogleKeyForm hasKey={detail.hasGoogleKey} onSave={(key) => actions.saveGoogleKey?.(key)} />
      <OpacitySlider actions={actions} row={row} />
      <SoftenBackgroundSwitch soften={detail.softenBackground} actions={actions} />
    </div>
  )
}

function SoftenBackgroundSwitch({ soften, actions }: { soften: boolean; actions: LayerPanelActions }) {
  return (
    <Switch
      label={t('speciesKey.softenBackground')}
      hint={t('speciesKey.softenBackgroundHint')}
      checked={soften}
      onChange={(next) => actions.softenBackground?.(next)}
    />
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
