import { useRef } from 'preact/hooks'
import type { CanvasToolbarActionCommand } from '../../app/canvas-commands'
import { currentCanvasQuerySurface } from '../../canvas/session'
import { t } from '../../i18n'
import { ControlIcon } from '../shared/ControlIcon'
import { useMapOccluder, useUnderRail } from '../shared/useMapChrome'
import styles from './RulersNorthHint.module.css'

/**
 * The rulers hint (spec §4.6; pattern canvas-navigation.md): rulers show only while north is up, so on a turned map
 * in site mode with Rulers on, a quiet glass pill above the view chip says so, with a Reset north link that runs
 * Keyboard's `reset-north` command. It lives in the view chip's wrapper, so the chip's narrow-canvas rule hides both;
 * it ends the tool rail and frames the map like the chip; it has no live role.
 */
export function RulersNorthHint({ rulersOn, resetNorth }: {
  readonly rulersOn: boolean
  readonly resetNorth: CanvasToolbarActionCommand
}) {
  const hint = useRef<HTMLDivElement>(null)
  const view = currentCanvasQuerySurface.value?.view
  const shown = rulersOn && view !== undefined && !view.northUp.value && view.mode.value === 'site'
  useUnderRail(hint, 'tool', shown)
  useMapOccluder(hint, 'bottom', shown)
  if (!shown) return null
  return (
    <div ref={hint} className={styles.hint} data-rulers-north-hint>
      <ControlIcon name="ruler" />
      <span>{t('canvas.grid.rulersNorthUpOnly')}</span>
      <button
        type="button"
        className={styles.link}
        data-command={resetNorth.commandId}
        aria-keyshortcuts={resetNorth.ariaShortcut}
        aria-disabled={resetNorth.disabled ? true : undefined}
        onClick={() => { if (!resetNorth.disabled) resetNorth.action() }}
      >
        {resetNorth.label}
      </button>
    </div>
  )
}
