import { t } from '../../i18n'
import {
  type CanvasLayerPresentationDetail,
  type CanvasLayerPresentationRow,
  readCanvasLayerPresentation,
  setCanvasLayerPresentationActiveLayer,
  setCanvasLayerPresentationContourIntervalMeters,
  setCanvasLayerPresentationLocked,
  setCanvasLayerPresentationOpacity,
  setCanvasLayerPresentationVisibility,
  toggleCanvasLayerPresentationPanel,
} from '../../app/canvas-layer-presentation/presentation'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import styles from './LayerPanel.module.css'

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
      <rect x="4" y="7" width="8" height="6.2" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      {locked ? (
        <path
          d="M5.8 7V5.4C5.8 4.1 6.8 3.1 8 3.1C9.2 3.1 10.2 4.1 10.2 5.4V7"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M5.8 7V5.4C5.8 4.1 6.8 3.1 8 3.1C9 3.1 9.8 3.8 10.1 4.7"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      )}
      <path d="M8 9.2V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function LayerPanel() {
  const presentation = readCanvasLayerPresentation()

  if (!presentation.panelOpen) {
    return (
      <div className={styles.panelCollapsed}>
        <button
          type="button"
          className={styles.collapseBtn}
          aria-label={t('canvas.layers.layerPanel')}
          onClick={toggleCanvasLayerPresentationPanel}
        >
          <ChevronIcon direction="left" />
        </button>
      </div>
    )
  }

  return (
    <aside className={styles.panel} aria-label={t('canvas.layers.layerPanel')}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>{t('canvas.layers.layerPanel')}</span>
        <button
          type="button"
          className={styles.collapseBtn}
          aria-label={t('canvas.layers.collapse')}
          onClick={toggleCanvasLayerPresentationPanel}
        >
          <ChevronIcon direction="right" />
        </button>
      </div>

      <div role="list">
        {presentation.rows.map((row) => {
          const lockLabel = row.locked ? t('canvas.layers.unlockLayer') : t('canvas.layers.lockLayer')
          return (
            <div key={row.id}>
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
                  onClick={() => {
                    setCanvasLayerPresentationVisibility(row.id, !row.visible)
                  }}
                >
                  <EyeIcon open={row.visible} />
                </button>
                <button
                  type="button"
                  className={styles.layerName}
                  onClick={() => setCanvasLayerPresentationActiveLayer(row.id)}
                >
                  {row.label}
                </button>
                {row.canLock ? (
                  <button
                    type="button"
                    className={styles.lockBtn}
                    aria-label={`${lockLabel}: ${row.label}`}
                    aria-pressed={row.locked}
                    onClick={() => {
                      setCanvasLayerPresentationLocked(row.id, !row.locked)
                    }}
                  >
                    <LockIcon locked={row.locked} />
                    <ButtonTooltip label={lockLabel} side="left" />
                  </button>
                ) : (
                  <span className={styles.lockSlot} aria-hidden="true" />
                )}
              </div>
              {row.active && <LayerDetail row={row} />}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

function LayerDetail({ row }: { row: CanvasLayerPresentationRow }) {
  switch (row.detail.type) {
    case 'location-map':
      return <LocationLayerDetail row={row} detail={row.detail} />
    case 'contours':
      return <ContourLayerDetail row={row} detail={row.detail} />
    case 'hillshade':
      return <HillshadeLayerDetail row={row} />
    case 'scene':
      return <SceneLayerDetail row={row} />
  }
}

function LocationLayerDetail({ row, detail }: {
  row: CanvasLayerPresentationRow
  detail: Extract<CanvasLayerPresentationDetail, { type: 'location-map' }>
}) {
  return (
    <div className={styles.layerDetail}>
      <div className={styles.locationCard} data-has-location={detail.hasLocation ? 'true' : 'false'}>
        <span className={styles.locationCardLabel}>
          {detail.hasLocation ? t('canvas.location.current') : t('canvas.location.required')}
        </span>
        <span className={styles.locationCardText}>
          {detail.hasLocation ? detail.locationSummary : t('canvas.layers.setLocation')}
        </span>
      </div>
      <OpacitySlider row={row} disabled={detail.opacityDisabled} />
    </div>
  )
}

function ContourLayerDetail({ row, detail }: {
  row: CanvasLayerPresentationRow
  detail: Extract<CanvasLayerPresentationDetail, { type: 'contours' }>
}) {
  return (
    <div className={styles.layerDetail}>
      <OpacitySlider row={row} />
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
            setCanvasLayerPresentationContourIntervalMeters(Number((event.target as HTMLInputElement).value))
          }}
        />
      </div>
    </div>
  )
}

function HillshadeLayerDetail({ row }: { row: CanvasLayerPresentationRow }) {
  return (
    <div className={styles.layerDetail}>
      <div className={styles.controlRow}>
        <span className={styles.controlLabel}>{t('canvas.terrain.hillshadeOpacity')}</span>
        <input
          type="range"
          className={styles.mapSlider}
          min="0"
          max="100"
          value={Math.round(row.opacity * 100)}
          aria-label={t('canvas.terrain.hillshadeOpacity')}
          onInput={(event) => {
            setCanvasLayerPresentationOpacity(row.id, Number((event.target as HTMLInputElement).value) / 100)
          }}
        />
      </div>
    </div>
  )
}

function SceneLayerDetail({ row }: { row: CanvasLayerPresentationRow }) {
  return (
    <div className={styles.layerDetail}>
      <OpacitySlider row={row} />
    </div>
  )
}

function OpacitySlider({ row, disabled }: { row: CanvasLayerPresentationRow; disabled?: boolean }) {
  const opacity = Math.round(row.opacity * 100)
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
          setCanvasLayerPresentationOpacity(row.id, Number((event.target as HTMLInputElement).value) / 100)
        }}
      />
    </div>
  )
}
