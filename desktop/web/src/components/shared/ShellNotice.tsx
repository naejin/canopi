import styles from './ShellNotice.module.css'

export type ShellNoticeAction = {
  label: string
  onClick?: () => void
  disabled?: boolean
  title?: string
}

export type ShellNoticeProps = {
  noticeKey?: string
  tone?: 'default' | 'warning' | 'danger'
  role?: 'status' | 'alert'
  live?: 'polite' | 'assertive' | 'off'
  message: string
  detail?: string | null
  primaryAction?: ShellNoticeAction
  secondaryAction?: ShellNoticeAction
}

export function ShellNotice({
  noticeKey,
  tone = 'default',
  role = 'status',
  live = 'off',
  message,
  detail = null,
  primaryAction,
  secondaryAction,
}: ShellNoticeProps) {
  const toneClass =
    tone === 'warning'
      ? styles.noticeWarning
      : tone === 'danger'
        ? styles.noticeDanger
        : styles.noticeDefault

  return (
    <div
      className={`${styles.notice} ${toneClass}`}
      role={role}
      aria-live={live}
      data-shell-notice={noticeKey}
    >
      <div className={styles.content}>
        <span className={styles.message}>{message}</span>
        {detail && <span className={styles.detail}>{detail}</span>}
      </div>
      {(secondaryAction || primaryAction) && (
        <div className={styles.actions}>
          {secondaryAction && (
            <button
              className={styles.ghostButton}
              type="button"
              disabled={secondaryAction.disabled}
              title={secondaryAction.title}
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </button>
          )}
          {primaryAction && (
            <button
              className={styles.primaryButton}
              type="button"
              disabled={primaryAction.disabled}
              title={primaryAction.title}
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
