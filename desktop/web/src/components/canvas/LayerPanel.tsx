import { t } from '../../i18n'
import { locale } from '../../state/app'
import { currentDesign } from '../../state/document'
import {
  activeLayerName,
  gridVisible,
  layerLockState,
  layerOpacity,
  layerPanelOpen,
  layerVisibility,
} from '../../state/canvas'
import {
  setActiveLayer,
  setLayerOpacity,
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
  const hasLocation = currentDesign.value?.location != null

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
            aria-label={`${t('canvas.layers.visibility')}: ${t('canvas.layers.base')}`}
            onClick={toggleGridVisibility}
          >
            <EyeIcon open={gridVisible.value} />
          </button>
          <span className={styles.overlayLabel}>{t('canvas.layers.base')}</span>
        </div>
      </div>

      <div className={styles.mapSection}>
        <div className={styles.sectionHeader}>{t(layerLabelKey(activeLayer))}</div>
        {activeLayer === 'base' && !hasLocation && (
          <div className={styles.mapHint}>{t('canvas.layers.setLocation')}</div>
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
    </aside>
  )
}
