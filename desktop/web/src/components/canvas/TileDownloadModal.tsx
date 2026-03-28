import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { offlineTilesAvailable } from '../../state/canvas'
import {
  downloadTiles,
  getOfflineStatus,
  removeOfflineTiles,
  type OfflineStatus,
  type TileDownloadProgress,
} from '../../ipc/tiles'
import { listen } from '@tauri-apps/api/event'
import styles from './TileDownloadModal.module.css'

interface TileDownloadModalProps {
  onClose: () => void
}

/**
 * Estimate tile count for a bounding box and zoom range.
 * Mirrors the Rust `count_tiles` logic.
 */
function estimateTileCount(
  bbox: [number, number, number, number],
  minZoom: number,
  maxZoom: number,
): number {
  let total = 0
  for (let z = minZoom; z <= maxZoom; z++) {
    const n = Math.pow(2, z)
    const xMin = Math.floor(((bbox[0] + 180) / 360) * n)
    const xMax = Math.floor(((bbox[2] + 180) / 360) * n)
    const latRadS = (bbox[1] * Math.PI) / 180
    const latRadN = (bbox[3] * Math.PI) / 180
    const yMin = Math.floor(
      ((1 - Math.log(Math.tan(latRadN) + 1 / Math.cos(latRadN)) / Math.PI) / 2) * n,
    )
    const yMax = Math.floor(
      ((1 - Math.log(Math.tan(latRadS) + 1 / Math.cos(latRadS)) / Math.PI) / 2) * n,
    )
    const xCount = Math.min(xMax, n - 1) - Math.min(xMin, n - 1) + 1
    const yCount = Math.min(yMax, n - 1) - Math.min(yMin, n - 1) + 1
    total += xCount * yCount
  }
  return total
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function TileDownloadModal({ onClose }: TileDownloadModalProps) {
  // Force re-render on locale change
  void locale.value

  // Bounding box inputs: [west, south, east, north]
  const west = useSignal('-1.0')
  const south = useSignal('43.0')
  const east = useSignal('1.0')
  const north = useSignal('45.0')
  const minZoom = useSignal(10)
  const maxZoom = useSignal(14)

  // State
  const status = useSignal<OfflineStatus | null>(null)
  const downloading = useSignal(false)
  const progress = useSignal<TileDownloadProgress | null>(null)
  const error = useSignal('')

  // Fetch current offline status on mount
  useEffect(() => {
    getOfflineStatus()
      .then((s) => {
        status.value = s
        offlineTilesAvailable.value = s.available
        // Pre-populate bbox from existing download if available
        if (s.bbox) {
          west.value = s.bbox[0].toFixed(4)
          south.value = s.bbox[1].toFixed(4)
          east.value = s.bbox[2].toFixed(4)
          north.value = s.bbox[3].toFixed(4)
        }
        if (s.min_zoom != null) minZoom.value = s.min_zoom
        if (s.max_zoom != null) maxZoom.value = s.max_zoom
      })
      .catch(() => {
        /* non-critical */
      })
  }, [])

  // Listen for progress events
  useEffect(() => {
    let unlisten: (() => void) | null = null
    listen<TileDownloadProgress>('tile-download-progress', (event) => {
      progress.value = event.payload
      // Download complete when downloaded === total
      if (event.payload.downloaded >= event.payload.total) {
        downloading.value = false
        // Refresh status
        getOfflineStatus().then((s) => {
          status.value = s
          offlineTilesAvailable.value = s.available
        }).catch(() => {})
      }
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  // Click on overlay background to close
  function handleOverlayClick(e: MouseEvent) {
    if (styles.overlay && (e.target as HTMLElement).classList.contains(styles.overlay)) {
      onClose()
    }
  }

  const bbox: [number, number, number, number] = [
    parseFloat(west.value) || 0,
    parseFloat(south.value) || 0,
    parseFloat(east.value) || 0,
    parseFloat(north.value) || 0,
  ]
  const tileCount = estimateTileCount(bbox, minZoom.value, maxZoom.value)
  const tooMany = tileCount > 50_000

  async function handleDownload() {
    error.value = ''
    downloading.value = true
    progress.value = null

    try {
      await downloadTiles(bbox, minZoom.value, maxZoom.value)
    } catch (e) {
      error.value = String(e)
      downloading.value = false
    }
  }

  async function handleRemove() {
    error.value = ''
    try {
      await removeOfflineTiles()
      status.value = {
        available: false,
        bbox: null,
        min_zoom: null,
        max_zoom: null,
        tile_count: 0,
        size_bytes: 0,
      }
      offlineTilesAvailable.value = false
      progress.value = null
    } catch (e) {
      error.value = String(e)
    }
  }

  const progressPct =
    progress.value && progress.value.total > 0
      ? Math.round((progress.value.downloaded / progress.value.total) * 100)
      : 0

  return (
    <div className={styles.overlay} onPointerUp={handleOverlayClick}>
      <div className={styles.modal} role="dialog" aria-label={t('canvas.terrain.offlineTiles')}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>{t('canvas.terrain.offlineTiles')}</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t('common.close')}
          >
            &#x2715;
          </button>
        </div>

        {/* Current offline status */}
        {status.value?.available && (
          <div className={styles.statusSection}>
            <div className={styles.statusRow}>
              <span>{t('canvas.terrain.offlineStatus')}</span>
              <span className={styles.statusValue}>
                {status.value.tile_count} tiles ({formatBytes(status.value.size_bytes)})
              </span>
            </div>
            {status.value.min_zoom != null && status.value.max_zoom != null && (
              <div className={styles.statusRow}>
                <span>{t('canvas.terrain.zoomRange')}</span>
                <span className={styles.statusValue}>
                  z{status.value.min_zoom} &ndash; z{status.value.max_zoom}
                </span>
              </div>
            )}
            {status.value.bbox && (
              <div className={styles.statusRow}>
                <span>{t('canvas.terrain.tileRegion')}</span>
                <span className={styles.statusValue}>
                  {status.value.bbox[0].toFixed(2)}, {status.value.bbox[1].toFixed(2)} &ndash;{' '}
                  {status.value.bbox[2].toFixed(2)}, {status.value.bbox[3].toFixed(2)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Bounding box section */}
        <div className={styles.section}>
          <h3 className={styles.sectionLabel}>{t('canvas.terrain.tileRegion')}</h3>
          <div className={styles.bboxGrid}>
            <label className={styles.fieldLabel}>
              <span>West</span>
              <input
                type="number"
                className={styles.input}
                value={west.value}
                onInput={(e) => { west.value = e.currentTarget.value }}
                step="0.01"
                min="-180"
                max="180"
              />
            </label>
            <label className={styles.fieldLabel}>
              <span>East</span>
              <input
                type="number"
                className={styles.input}
                value={east.value}
                onInput={(e) => { east.value = e.currentTarget.value }}
                step="0.01"
                min="-180"
                max="180"
              />
            </label>
            <label className={styles.fieldLabel}>
              <span>South</span>
              <input
                type="number"
                className={styles.input}
                value={south.value}
                onInput={(e) => { south.value = e.currentTarget.value }}
                step="0.01"
                min="-90"
                max="90"
              />
            </label>
            <label className={styles.fieldLabel}>
              <span>North</span>
              <input
                type="number"
                className={styles.input}
                value={north.value}
                onInput={(e) => { north.value = e.currentTarget.value }}
                step="0.01"
                min="-90"
                max="90"
              />
            </label>
          </div>
        </div>

        {/* Zoom range */}
        <div className={styles.section}>
          <h3 className={styles.sectionLabel}>{t('canvas.terrain.zoomRange')}</h3>
          <div className={styles.zoomRow}>
            <input
              type="number"
              className={styles.zoomInput}
              value={minZoom.value}
              onInput={(e) => {
                const v = parseInt(e.currentTarget.value, 10)
                if (!isNaN(v) && v >= 0 && v <= 18) minZoom.value = v
              }}
              min="0"
              max="18"
            />
            <span className={styles.zoomSep}>&ndash;</span>
            <input
              type="number"
              className={styles.zoomInput}
              value={maxZoom.value}
              onInput={(e) => {
                const v = parseInt(e.currentTarget.value, 10)
                if (!isNaN(v) && v >= 0 && v <= 18) maxZoom.value = v
              }}
              min="0"
              max="18"
            />
          </div>
          <div className={styles.tileCount}>
            ~{tileCount.toLocaleString()} tiles
            {tooMany && <span className={styles.error}> (max 50,000)</span>}
          </div>
        </div>

        {/* Progress bar */}
        {downloading.value && progress.value && (
          <div className={styles.progressSection}>
            <div className={styles.progressLabel}>{t('canvas.terrain.downloadProgress')}</div>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className={styles.progressText}>
              {progress.value.downloaded} / {progress.value.total} ({progressPct}%)
            </div>
          </div>
        )}

        {/* Error */}
        {error.value && <div className={styles.error}>{error.value}</div>}

        {/* Actions */}
        <div className={styles.actions}>
          {status.value?.available && (
            <button
              type="button"
              className={styles.removeBtn}
              onClick={handleRemove}
              disabled={downloading.value}
            >
              {t('canvas.terrain.removeOffline')}
            </button>
          )}
          <button
            type="button"
            className={styles.downloadBtn}
            onClick={handleDownload}
            disabled={downloading.value || tooMany || minZoom.value > maxZoom.value}
          >
            {downloading.value ? t('canvas.terrain.downloadProgress') : t('canvas.terrain.downloadTiles')}
          </button>
        </div>
      </div>
    </div>
  )
}
