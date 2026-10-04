import type { ComponentChildren } from 'preact'
import styles from './EmptyState.module.css'

/** An empty list: what is missing, how to fill it, and the one action that does. */
export function EmptyState({ icon, children, action, status = false }: {
  readonly icon?: ComponentChildren
  readonly children: ComponentChildren
  readonly action?: { readonly label: string; onClick(): void }
  /** Announce the message (for empties caused by a search or filter). */
  readonly status?: boolean
}) {
  return (
    <div className={styles.empty}>
      <div className={styles.message} role={status ? 'status' : undefined}>
        {icon && <span className={styles.icon} aria-hidden="true">{icon}</span>}
        <p>{children}</p>
      </div>
      {action && <button type="button" className={styles.action} onClick={action.onClick}>{action.label}</button>}
    </div>
  )
}
