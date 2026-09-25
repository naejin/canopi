import styles from './ButtonTooltip.module.css'

/** `top` opens above the button, aligned to its end edge (for bottom-edge bars). */
export type ButtonTooltipSide = 'left' | 'right' | 'top'

interface ButtonTooltipProps {
  label: string
  description?: string
  shortcut?: string
  side?: ButtonTooltipSide
}

export function ButtonTooltip({
  label,
  description,
  shortcut,
  side = 'right',
}: ButtonTooltipProps) {
  const sideClass = { left: styles.tooltipLeft, right: styles.tooltipRight, top: styles.tooltipTop }[side]

  return (
    <span className={`${styles.tooltip} ${sideClass}`} role="tooltip">
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
