import styles from './ButtonTooltip.module.css'

/**
 * `top` opens above the button and `bottom` below it, both aligned to its end
 * edge (for bars along the bottom or top of the window).
 */
type ButtonTooltipSide = 'left' | 'right' | 'top' | 'bottom'

interface ButtonTooltipProps {
  label: string
  description?: string
  shortcut?: string
  side?: ButtonTooltipSide
  /** Shown whatever the hover or focus: a reason a tap asked for on a touch screen, which has no hover. */
  shown?: boolean
}

export function ButtonTooltip({
  label,
  description,
  shortcut,
  side = 'right',
  shown = false,
}: ButtonTooltipProps) {
  const sideClass = { left: styles.tooltipLeft, right: styles.tooltipRight, top: styles.tooltipTop, bottom: styles.tooltipBottom }[side]

  return (
    <span className={`${styles.tooltip} ${sideClass}${shown ? ` ${styles.tooltipShown}` : ''}`} role="tooltip">
      <span className={styles.tooltipName}>{label}</span>
      {shortcut && <span className={styles.tooltipShortcut}>{shortcut}</span>}
      {description && (
        <>
          <br />
          <span className={styles.tooltipDesc}>{description}</span>
        </>
      )}
    </span>
  )
}
