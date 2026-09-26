import type { ComponentChildren } from 'preact'
import { ControlIcon } from './ControlIcon'
import styles from './Notice.module.css'

export type NoticeTone = 'info' | 'warning' | 'error'

/**
 * An inline message: info (quiet), warning (amber, announced politely) or error
 * (red, announced as an alert). Say what happened, what is safe and the next step.
 */
export function Notice({ tone, children, action, className }: {
  readonly tone: NoticeTone
  readonly children: ComponentChildren
  /** One follow-up action, e.g. a Retry or Details… button. */
  readonly action?: ComponentChildren
  readonly className?: string
}) {
  const role = tone === 'error' ? 'alert' : tone === 'warning' ? 'status' : undefined
  return (
    <div className={`${styles.notice} ${styles[tone]}${className ? ` ${className}` : ''}`} role={role} data-notice-tone={tone}>
      <ControlIcon name={tone === 'info' ? 'info' : 'alert'} size={18} className={styles.icon} />
      <div className={styles.body}>{children}</div>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}
