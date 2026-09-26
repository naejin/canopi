import type { DesignSaveStatus } from '../../app/document-session/continuous-save'
import { t } from '../../i18n'
import { ControlIcon } from './ControlIcon'
import styles from './save-status-label.module.css'

interface SaveStatusLabelProps {
  readonly status: DesignSaveStatus
  onRetry(): void
  onResolveConflict(): void
}

/** Quiet continuous-save status beside the Design name in both editions' title bars. */
export function SaveStatusLabel({ status, onRetry, onResolveConflict }: SaveStatusLabelProps) {
  return (
    <span className={styles.status} role="status" data-save-status={status}>
      {status === 'saving' && <span className={styles.text}><ControlIcon name="clock" />{t('saveStatus.saving')}</span>}
      {status === 'saved' && <span className={styles.text}><ControlIcon name="check" />{t('saveStatus.saved')}</span>}
      {status === 'error' && (
        <>
          <span className={styles.errorText}><ControlIcon name="alert" />{t('saveStatus.error')}</span>
          <button type="button" className={styles.action} onClick={onRetry}>
            {t('saveStatus.retry')}
          </button>
        </>
      )}
      {status === 'conflict' && (
        <button type="button" className={styles.conflictAction} onClick={onResolveConflict}>
          <ControlIcon name="alert" />{t('saveStatus.conflict')}
        </button>
      )}
    </span>
  )
}
