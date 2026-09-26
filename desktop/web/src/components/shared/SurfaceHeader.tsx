import type { ComponentChildren } from 'preact'
import { ButtonTooltip } from './ButtonTooltip'
import { ControlIcon } from './ControlIcon'
import styles from './SurfaceHeader.module.css'

/** Shared chrome; callers retain navigation and dismissal ownership. */
export function SurfaceHeader({ title, count, actions, onClose, closeLabel }: {
  title: string
  count?: number
  actions?: ComponentChildren
  onClose(): void
  closeLabel: string
}) {
  return (
    <header className={styles.header}>
      <h2 className={styles.title}>{title}</h2>
      {count !== undefined && <span className={styles.count}>{count}</span>}
      <div className={styles.actions}>
        {actions}
        <button type="button" className={styles.close} aria-label={closeLabel} onClick={onClose}>
          <ControlIcon name="close" size={18} />
          <ButtonTooltip label={closeLabel} side="left" />
        </button>
      </div>
    </header>
  )
}
