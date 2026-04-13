import { t } from '../../i18n'
import { locale } from '../../app/shell/state'
import { layerPanelView } from '../../app/canvas-settings/state'
import { currentDesign } from '../../state/document'
import {
  setActiveLayer,
  setContourIntervalMeters,
  setHillshadeOpacity,
  setLayerOpacity,
  toggleHillshadeVisibility,
  toggleLayerPanel,
  toggleLayerVisibility,
} from '../../app/canvas-settings/controller'
import { formatLocationSummary } from '../../utils/location'
import styles from './LayerPanel.module.css'

const ALL_LAYERS = ['annotations', 'plants', 'zones', 'base', 'contours', 'hillshading'] as const
type LayerName = typeof ALL_LAYERS[number]

function layerLabel(name: LayerName): string {
  switch (name) {
    case 'base': return t('canvas.layers.basemap')
    case 'contours': return t('canvas.terrain.contours')
    case 'hillshading': return t('canvas.terrain.hillshade')
    default: return t(`canvas.layers.${name}`)
  }
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  const d = direction === 'left' ? 'M10 3L5 8L10 13' : 'M6 3L11 8L6 13'
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.2 8C1.2 8 3.7 3.5 8 3.5C12.3 3.5 14.8 8 14.8 8C14.8 8 12.3 12.5 8 12.5C3.7 12.5 1.2 8 1.2 8Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      {open ? <circle cx="8" cy="8" r="2.2" fill="currentColor" /> : <path d="M2 2L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
    </svg>
  )
}

function getVisibility(name: LayerName): boolean {
  const view = layerPanelView.peek()
  if (name === 'hillshading') return view.hillshadeVisible
  return view.layerVisibility[name] ?? true
}

function handleToggleVisibility(name: LayerName): void {
  if (name === 'hillshading') toggleHillshadeVisibility()
  else toggleLayerVisibility(name)
}

export function LayerPanel() {
  void locale.value

  const {
    activeLayerName: activeLayerNameValue,
    contourIntervalMeters: contourIntervalMetersValue,
    hillshadeOpacity: hillshadeOpacityValue,
    layerOpacity: layerOpacityValue,
    layerPanelOpen: open,
  } = layerPanelView.value
  const activeLayer = activeLayerNameValue as LayerName

  if (!open) {
    return (
      <div className={styles.panelCollapsed}>
        <button
          type="button"
          className={styles.collapseBtn}
          aria-label={t('canvas.layers.layerPanel')}
          onClick={toggleLayerPanel}
        >
          <ChevronIcon direction="left" />
        </button>
      </div>
    )
  }

  const location = currentDesign.value?.location ?? null
  const hasLocation = location != null

  return (
    <aside className={styles.panel} aria-label={t('canvas.layers.layerPanel')}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>{t('canvas.layers.layerPanel')}</span>
        <button
          type="button"
          className={styles.collapseBtn}
          aria-label={t('canvas.layers.collapse')}
          onClick={toggleLayerPanel}
        >
          <ChevronIcon direction="right" />
        </button>
      </div>

      <div role="list">
        {ALL_LAYERS.map((name) => {
          const visible = getVisibility(name)
          const active = activeLayer === name
          const label = layerLabel(name)

          return (
            <div key={name}>
              <div
                role="listitem"
                className={styles.layerRow}
                data-active={active ? 'true' : 'false'}
                data-hidden={visible ? 'false' : 'true'}
              >
                <button
                  type="button"
                  className={styles.toggleBtn}
                  aria-label={`${t('canvas.layers.visibility')}: ${label}`}
                  onClick={() => handleToggleVisibility(name)}
                >
                  <EyeIcon open={visible} />
                </button>
                <button
                  type="button"
                  className={styles.layerName}
                  onClick={() => setActiveLayer(name)}
                >
                  {label}
                </button>
              </div>
              {active && (
                <LayerDetail
                  name={name}
                  hasLocation={hasLocation}
                  location={location}
                  contourIntervalMeters={contourIntervalMetersValue}
                  hillshadeOpacity={hillshadeOpacityValue}
                  layerOpacity={layerOpacityValue}
                />
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

function LayerDetail({ name, hasLocation, location, contourIntervalMeters, hillshadeOpacity, layerOpacity }: {
  name: LayerName
  hasLocation: boolean
  location: { lat: number; lon: number; altitude_m: number | null } | null
  contourIntervalMeters: number
  hillshadeOpacity: number
  layerOpacity: Record<string, number>
}) {
  switch (name) {
    case 'base':
      return (
        <div className={styles.layerDetail}>
          <div className={styles.locationCard} data-has-location={hasLocation ? 'true' : 'false'}>
            <span className={styles.locationCardLabel}>
              {hasLocation ? t('canvas.location.current') : t('canvas.location.required')}
            </span>
            <span className={styles.locationCardText}>
              {hasLocation && location ? formatLocationSummary(location) : t('canvas.layers.setLocation')}
            </span>
          </div>
          <OpacitySlider layer="base" disabled={!hasLocation} layerOpacity={layerOpacity} />
        </div>
      )
    case 'contours':
      return (
        <div className={styles.layerDetail}>
          <OpacitySlider layer="contours" layerOpacity={layerOpacity} />
          <div className={styles.controlRow}>
            <span className={styles.controlLabel}>{t('canvas.terrain.contourInterval')}</span>
            <input
              type="number"
              min="0"
              step="1"
              className={styles.numericInput}
              value={String(contourIntervalMeters)}
              aria-label={t('canvas.terrain.contourInterval')}
              onInput={(event) => {
                setContourIntervalMeters(Number((event.target as HTMLInputElement).value))
              }}
            />
          </div>
        </div>
      )
    case 'hillshading':
      return (
        <div className={styles.layerDetail}>
          <div className={styles.controlRow}>
            <span className={styles.controlLabel}>{t('canvas.terrain.hillshadeOpacity')}</span>
            <input
              type="range"
              className={styles.mapSlider}
              min="0"
              max="100"
              value={Math.round(hillshadeOpacity * 100)}
              aria-label={t('canvas.terrain.hillshadeOpacity')}
              onInput={(event) => {
                setHillshadeOpacity(Number((event.target as HTMLInputElement).value) / 100)
              }}
            />
          </div>
        </div>
      )
    default:
      return (
        <div className={styles.layerDetail}>
          <OpacitySlider layer={name} layerOpacity={layerOpacity} />
        </div>
      )
  }
}

function OpacitySlider({ layer, disabled, layerOpacity }: { layer: string; disabled?: boolean; layerOpacity: Record<string, number> }) {
  const opacity = Math.round((layerOpacity[layer] ?? 1) * 100)
  return (
    <div className={styles.controlRow}>
      <span className={styles.controlLabel}>{t('canvas.layers.opacity')}</span>
      <input
        type="range"
        className={styles.mapSlider}
        min="0"
        max="100"
        value={opacity}
        disabled={disabled}
        onInput={(event) => {
          setLayerOpacity(layer, Number((event.target as HTMLInputElement).value) / 100)
        }}
      />
    </div>
  )
}
