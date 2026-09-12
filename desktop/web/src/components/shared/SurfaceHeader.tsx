import type { ComponentChildren } from 'preact'
import { ButtonTooltip } from './ButtonTooltip'
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="m6 6 12 12M6 18 18 6" />
          </svg>
          <ButtonTooltip label={closeLabel} side="left" />
        </button>
      </div>
    </header>
  )
}
