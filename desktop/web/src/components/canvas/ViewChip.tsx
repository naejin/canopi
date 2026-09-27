import type { CanvasToolbarActionCommand } from '../../app/canvas-commands'
import { t } from '../../i18n'
import { ControlIcon } from '../shared/ControlIcon'
import { useRef } from 'preact/hooks'
import { useMapOccluder, usePublishedWidth, useUnderRail } from '../shared/useMapChrome'
import styles from './ViewChip.module.css'

/**
 * The view chip at the bottom left: Grid, Snap to grid and Rulers as pressed
 * toggles. A pressed toggle shows a check, so its state never rests on colour.
 */
export function ViewChip({ toggles }: { readonly toggles: readonly CanvasToolbarActionCommand[] }) {
  const chip = useRef<HTMLDivElement>(null)
  useMapOccluder(chip, 'bottom')
  useUnderRail(chip, 'tool')
  // The attribution pill keeps clear of the chip.
  usePublishedWidth(chip, '--view-chip-width')
  return (
    <div ref={chip} className={styles.chip} role="group" aria-label={t('canvas.viewChip')} data-view-chip>
      {toggles.map((toggle) => (
        <button
          key={toggle.id}
          type="button"
          className={styles.toggle}
          data-command={toggle.commandId}
          aria-pressed={toggle.pressed ?? false}
          aria-keyshortcuts={toggle.ariaShortcut}
          aria-disabled={toggle.disabled ? true : undefined}
          onClick={() => { if (!toggle.disabled) toggle.action() }}
        >
          {toggle.pressed && <ControlIcon name="check" />}
          {toggle.label}
        </button>
      ))}
    </div>
  )
}
