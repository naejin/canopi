import { t } from '../../i18n'
import { locale } from '../../state/app'
import { currentDesign } from '../../state/document'
import {
  activeLayerName,
  contourIntervalMeters,
  hillshadeOpacity,
  hillshadeVisible,
  layerOpacity,
  layerPanelOpen,
  layerVisibility,
} from '../../state/canvas'
import {
  setActiveLayer,
  setContourIntervalMeters,
  setHillshadeOpacity,
  setLayerOpacity,
  toggleHillshadeVisibility,
  toggleLayerPanel,
  toggleLayerVisibility,
} from '../../state/canvas-actions'
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
  if (name === 'hillshading') return hillshadeVisible.value
  return layerVisibility.value[name] ?? true
}

function handleToggleVisibility(name: LayerName): void {
  if (name === 'hillshading') toggleHillshadeVisibility()
  else toggleLayerVisibility(name)
}

export function LayerPanel() {
  void locale.value

  const open = layerPanelOpen.value
  const activeLayer = activeLayerName.value as LayerName

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
                />
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

function LayerDetail({ name, hasLocation, location }: {
  name: LayerName
  hasLocation: boolean
  location: { lat: number; lon: number; altitude_m: number | null } | null
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
          <OpacitySlider layer="base" disabled={!hasLocation} />
        </div>
      )
    case 'contours':
      return (
        <div className={styles.layerDetail}>
          <OpacitySlider layer="contours" />
          <div className={styles.controlRow}>
            <span className={styles.controlLabel}>{t('canvas.terrain.contourInterval')}</span>
            <input
              type="number"
              min="0"
              step="1"
              className={styles.numericInput}
              value={String(contourIntervalMeters.value)}
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
              value={Math.round(hillshadeOpacity.value * 100)}
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
          <OpacitySlider layer={name} />
        </div>
      )
  }
}

function OpacitySlider({ layer, disabled }: { layer: string; disabled?: boolean }) {
  const opacity = Math.round((layerOpacity.value[layer] ?? 1) * 100)
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
