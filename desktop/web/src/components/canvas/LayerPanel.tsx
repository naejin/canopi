import { t } from '../../i18n'
import { locale } from '../../state/app'
import { currentDesign } from '../../state/document'
import {
  activeLayerName,
  contourIntervalMeters,
  gridVisible,
  hillshadeOpacity,
  hillshadeVisible,
  layerLockState,
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
  toggleGridVisibility,
  toggleLayerLock,
  toggleLayerPanel,
  toggleLayerVisibility,
} from '../../state/canvas-actions'
import styles from './LayerPanel.module.css'

const LAYER_ORDER = ['annotations', 'plants', 'zones', 'base'] as const
type LayerName = typeof LAYER_ORDER[number]

function layerLabelKey(name: LayerName): string {
  return name === 'base' ? 'canvas.layers.basemap' : `canvas.layers.${name}`
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

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.2" y="7" width="9.6" height="6.2" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      {locked ? (
        <path d="M5.2 7V5.4C5.2 3.9 6.3 2.8 7.8 2.8C9.3 2.8 10.4 3.9 10.4 5.4V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      ) : (
        <path d="M5.2 7V5.4C5.2 3.9 6.3 2.8 7.8 2.8C8.7 2.8 9.6 3.2 10 3.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      )}
    </svg>
  )
}

function formatLocationSummary(location: { lat: number; lon: number; altitude_m: number | null }): string {
  const base = `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`
  return location.altitude_m != null ? `${base} (${location.altitude_m} m)` : base
}

function clampPercent(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100)
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

  const activeOpacity = Math.round((layerOpacity.value[activeLayer] ?? 1) * 100)
  const contoursVisible = layerVisibility.value.contours ?? false
  const contoursOpacity = clampPercent(layerOpacity.value.contours ?? 1)
  const contourInterval = contourIntervalMeters.value
  const hillshadeOn = hillshadeVisible.value
  const hillshadeLevel = clampPercent(hillshadeOpacity.value)
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
        {LAYER_ORDER.map((name) => {
          const isBase = name === 'base'
          const visible = layerVisibility.value[name] ?? true
          const locked = layerLockState.value[name] ?? false
          const active = activeLayer === name

          return (
            <div
              key={name}
              role="listitem"
              className={styles.layerRow}
              data-active={active ? 'true' : 'false'}
              data-hidden={visible ? 'false' : 'true'}
            >
              <button
                type="button"
                className={styles.toggleBtn}
                aria-label={`${t('canvas.layers.visibility')}: ${t(layerLabelKey(name))}`}
                onClick={() => toggleLayerVisibility(name)}
              >
                <EyeIcon open={visible} />
              </button>
              {!isBase && (
                <button
                  type="button"
                  className={styles.toggleBtn}
                  aria-label={`${t('canvas.layers.lock')}: ${t(`canvas.layers.${name}`)}`}
                  onClick={() => toggleLayerLock(name)}
                >
                  <LockIcon locked={locked} />
                </button>
              )}
              <button
                type="button"
                className={styles.layerName}
                onClick={() => setActiveLayer(name)}
              >
                {t(layerLabelKey(name))}
              </button>
            </div>
          )
        })}
      </div>

      <div className={styles.overlaySection}>
        <div className={styles.sectionHeader}>{t('canvas.grid.grid')}</div>
        <div className={styles.overlayRow}>
          <button
            type="button"
            className={styles.toggleBtn}
            aria-label={`${t('canvas.layers.visibility')}: ${t('canvas.grid.grid')}`}
            onClick={toggleGridVisibility}
          >
            <EyeIcon open={gridVisible.value} />
          </button>
          <span className={styles.overlayLabel}>{t('canvas.grid.grid')}</span>
        </div>
      </div>

      <div className={styles.mapSection}>
        <div className={styles.sectionHeader}>{t(layerLabelKey(activeLayer))}</div>
        {activeLayer === 'base' && (
          <div className={styles.locationCard} data-has-location={hasLocation ? 'true' : 'false'}>
            <span className={styles.locationCardLabel}>
              {hasLocation ? t('canvas.location.current') : t('canvas.location.required')}
            </span>
            <span className={styles.locationCardText}>
              {hasLocation ? formatLocationSummary(location) : t('canvas.layers.setLocation')}
            </span>
          </div>
        )}
        <div className={styles.mapSliderRow}>
          <span className={styles.mapSliderLabel}>{t('canvas.layers.opacity')}</span>
          <input
            type="range"
            className={styles.mapSlider}
            min="0"
            max="100"
            value={activeOpacity}
            disabled={activeLayer === 'base' && !hasLocation}
            onInput={(event) => {
              setLayerOpacity(activeLayer, Number((event.target as HTMLInputElement).value) / 100)
            }}
          />
        </div>
      </div>

      <div className={styles.terrainSection}>
        <div className={styles.sectionHeader}>{t('canvas.layers.mapSection')}</div>
        <div
          className={styles.terrainRow}
          data-hidden={contoursVisible ? 'false' : 'true'}
        >
          <button
            type="button"
            className={styles.toggleBtn}
            aria-label={`${t('canvas.layers.visibility')}: ${t('canvas.terrain.contours')}`}
            onClick={() => toggleLayerVisibility('contours')}
          >
            <EyeIcon open={contoursVisible} />
          </button>
          <span className={styles.overlayLabel}>{t('canvas.terrain.contours')}</span>
        </div>
        <div className={styles.terrainControls}>
          <div className={styles.mapSliderRow}>
            <span className={styles.mapSliderLabel}>{t('canvas.layers.opacity')}</span>
            <input
              type="range"
              className={styles.mapSlider}
              min="0"
              max="100"
              value={contoursOpacity}
              disabled={!contoursVisible}
              aria-label={`${t('canvas.layers.opacity')}: ${t('canvas.terrain.contours')}`}
              onInput={(event) => {
                setLayerOpacity('contours', Number((event.target as HTMLInputElement).value) / 100)
              }}
            />
          </div>
          <label className={styles.numericControl}>
            <span className={styles.mapSliderLabel}>{t('canvas.terrain.contourInterval')}</span>
            <input
              type="number"
              min="0"
              step="1"
              className={styles.numericInput}
              value={String(contourInterval)}
              aria-label={t('canvas.terrain.contourInterval')}
              onInput={(event) => {
                setContourIntervalMeters(Number((event.target as HTMLInputElement).value))
              }}
            />
          </label>
        </div>

        <div
          className={styles.terrainRow}
          data-hidden={hillshadeOn ? 'false' : 'true'}
        >
          <button
            type="button"
            className={styles.toggleBtn}
            aria-label={`${t('canvas.layers.visibility')}: ${t('canvas.terrain.hillshade')}`}
            onClick={toggleHillshadeVisibility}
          >
            <EyeIcon open={hillshadeOn} />
          </button>
          <span className={styles.overlayLabel}>{t('canvas.terrain.hillshade')}</span>
        </div>
        <div className={styles.terrainControls}>
          <div className={styles.mapSliderRow}>
            <span className={styles.mapSliderLabel}>{t('canvas.terrain.hillshadeOpacity')}</span>
            <input
              type="range"
              className={styles.mapSlider}
              min="0"
              max="100"
              value={hillshadeLevel}
              disabled={!hillshadeOn}
              aria-label={t('canvas.terrain.hillshadeOpacity')}
              onInput={(event) => {
                setHillshadeOpacity(Number((event.target as HTMLInputElement).value) / 100)
              }}
            />
          </div>
        </div>
      </div>
    </aside>
  )
}
