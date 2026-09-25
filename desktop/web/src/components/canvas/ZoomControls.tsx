import {
  currentCanvasQuerySurface,
  currentCanvasViewportCommandSurface,
} from '../../canvas/session'
import { t } from '../../i18n'
import { VIEW_SHORTCUTS } from '../../shortcuts/definitions'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import styles from './ZoomControls.module.css'

export function ZoomControls() {
  const viewport = currentCanvasQuerySurface.value?.viewport.value
  const zoomPercent = viewport
    ? (viewport.viewport.scale / viewport.referenceScale) * 100
    : 100
  const zoomLabel = viewport?.mode === 'overview'
    ? t('canvas.overview.label')
    : formatZoomPercent(zoomPercent)
  const atMinimum = viewport
    ? viewport.viewport.scale <= viewport.scaleBounds.minimum
    : false
  const atMaximum = viewport
    ? viewport.viewport.scale >= viewport.scaleBounds.maximum
    : false
  const session = currentCanvasViewportCommandSurface.value

  return (
    <div className={styles.controls} role="group" aria-label={t('canvas.grid.zoom')}>
      <button
        className={styles.btn}
        type="button"
        disabled={atMinimum}
        onClick={() => session?.zoomOut()}
        aria-label={t('menu.view.zoomOut')}
        aria-keyshortcuts={ariaKeyShortcuts(VIEW_SHORTCUTS.zoomOut)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <ButtonTooltip label={t('menu.view.zoomOut')} shortcut={VIEW_SHORTCUTS.zoomOut} side="top" />
      </button>
      <span className={styles.level}>{zoomLabel}</span>
      <button
        className={styles.btn}
        type="button"
        disabled={atMaximum}
        onClick={() => session?.zoomIn()}
        aria-label={t('menu.view.zoomIn')}
        aria-keyshortcuts={ariaKeyShortcuts(VIEW_SHORTCUTS.zoomIn)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <ButtonTooltip label={t('menu.view.zoomIn')} shortcut={VIEW_SHORTCUTS.zoomIn} side="top" />
      </button>
      <button
        className={styles.btn}
        type="button"
        onClick={() => session?.zoomToFit()}
        aria-label={t('menu.view.fitToContent')}
        aria-keyshortcuts={ariaKeyShortcuts(VIEW_SHORTCUTS.fitToContent)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <ButtonTooltip label={t('menu.view.fitToContent')} shortcut={VIEW_SHORTCUTS.fitToContent} side="top" />
      </button>
    </div>
  )
}

function formatZoomPercent(percent: number): string {
  if (percent >= 1) return `${Math.round(percent)}%`
  if (percent >= 0.1) return `${percent.toFixed(1)}%`
  return `${percent.toFixed(2)}%`
}

/** `Ctrl+=` → `Control+= Meta+=`: the View shortcuts accept Ctrl or Cmd. */
function ariaKeyShortcuts(display: string): string {
  const key = display.replace(/^Ctrl\+/, '')
  return `Control+${key} Meta+${key}`
}
