import type { CanvasToolbarActionCommand } from '../../app/canvas-commands'
import { t } from '../../i18n'
import { ControlIcon } from '../shared/ControlIcon'
import { useRef } from 'preact/hooks'
import { useMapOccluder, usePublishedWidth, useUnderRail } from '../shared/useMapChrome'
import { RulersNorthHint } from './RulersNorthHint'
import styles from './ViewChip.module.css'

/**
 * The view chip at the bottom left: Grid, Snap to grid and Rulers as pressed
 * toggles. A pressed toggle shows a check, so its state never rests on colour.
 * Its wrapper also holds the rulers hint above it, so the narrow-canvas rule
 * hides both; the wrapper is as wide as the chip, the hint standing above it.
 */
export function ViewChip({ toggles, resetNorth }: {
  readonly toggles: readonly CanvasToolbarActionCommand[]
  /** Keyboard's `reset-north` command, for the rulers hint's link. */
  readonly resetNorth?: CanvasToolbarActionCommand
}) {
  const wrapper = useRef<HTMLDivElement>(null)
  const chip = useRef<HTMLDivElement>(null)
  useMapOccluder(chip, 'bottom')
  useUnderRail(chip, 'tool')
  // The attribution pill keeps clear of the chip.
  usePublishedWidth(wrapper, '--view-chip-width')
  const rulersOn = toggles.find((toggle) => toggle.id === 'rulers')?.pressed ?? false
  return (
    <div ref={wrapper} className={styles.wrapper}>
      {resetNorth && <RulersNorthHint rulersOn={rulersOn} resetNorth={resetNorth} />}
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
    </div>
  )
}
