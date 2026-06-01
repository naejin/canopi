import styles from './ButtonTooltip.module.css'

export type ButtonTooltipSide = 'left' | 'right'

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
  const sideClass = side === 'left' ? styles.tooltipLeft : styles.tooltipRight

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
