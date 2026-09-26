import { useEffect, useId, useRef, useState } from 'preact/hooks'
import type { DesignSaveStatus } from '../../app/document-session/continuous-save'
import { t } from '../../i18n'
import { ControlIcon } from './ControlIcon'
import styles from './save-status-label.module.css'

export interface SaveStatusAction {
  readonly label: string
  run(): void
}

interface SaveStatusLabelProps {
  readonly status: DesignSaveStatus
  /** The writer's reason for the last failure, shown in Details…. */
  readonly failureReason?: string | null
  /** "Draft" on Desktop, "Saved in this browser" on the Web. */
  readonly draftLabel: string
  /** The one action a Draft offers: Save as… (Desktop) or Download a copy (Web). */
  readonly draftAction: SaveStatusAction & { readonly style: 'button' | 'link' }
  /** Keeps the work somewhere else when writing failed. */
  readonly saveElsewhere: SaveStatusAction
  onRetry(): void
  onResolveConflict?(): void
}

/**
 * Continuous-save status beside the Design name, with its one action. Saving
 * is never announced; failures are alerts and open an explanation.
 */
export function SaveStatusLabel({
  status,
  failureReason = null,
  draftLabel,
  draftAction,
  saveElsewhere,
  onRetry,
  onResolveConflict,
}: SaveStatusLabelProps) {
  return (
    <span className={styles.status} data-save-status={status}>
      {status === 'saved' && (
        <span className={styles.text} role="status"><ControlIcon name="check" />{t('saveStatus.saved')}</span>
      )}
      {status === 'saving' && (
        <span className={styles.text} role="status">
          <ControlIcon name="clock" /><span aria-hidden="true">{t('saveStatus.saving')}</span>
        </span>
      )}
      {status === 'draft' && (
        <>
          <span className={styles.text} role="status"><ControlIcon name={draftAction.style === 'link' ? 'check' : 'draft'} />{draftLabel}</span>
          <button
            type="button"
            className={draftAction.style === 'link' ? styles.link : styles.action}
            onClick={draftAction.run}
          >
            {draftAction.label}
          </button>
        </>
      )}
      {status === 'error' && (
        <>
          <span className={styles.errorText} role="alert"><ControlIcon name="alert" />{t('saveStatus.error')}</span>
          <SaveFailureDetails reason={failureReason} onRetry={onRetry} saveElsewhere={saveElsewhere} />
        </>
      )}
      {status === 'conflict' && (
        <>
          <span className={styles.errorText} role="alert"><ControlIcon name="alert" />{t('saveStatus.conflict')}</span>
          {onResolveConflict && (
            <button type="button" className={styles.action} onClick={onResolveConflict}>
              {t('saveStatus.resolve')}
            </button>
          )}
        </>
      )}
    </span>
  )
}

function SaveFailureDetails({ reason, onRetry, saveElsewhere }: {
  readonly reason: string | null
  onRetry(): void
  readonly saveElsewhere: SaveStatusAction
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    popover.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const outside = (event: Event) => {
      const target = event.target as Node | null
      if (target && !popover.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerup', outside)
    return () => document.removeEventListener('pointerup', outside)
  }, [open])

  function close(): void {
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <span className={styles.detailsAnchor} data-preserve-overlays="true">
      <button
        ref={trigger}
        type="button"
        className={styles.action}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t('saveStatus.details')}
      </button>
      {open && (
        <div
          ref={popover}
          className={styles.popover}
          role="dialog"
          aria-labelledby={titleId}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            close()
          }}
        >
          <h2 className={styles.popoverTitle} id={titleId}>{t('saveStatus.detailsTitle')}</h2>
          <p className={styles.popoverText}>
            {reason ? t('saveStatus.detailsReason', { reason }) : t('saveStatus.detailsUnknown')}
          </p>
          <p className={styles.popoverText}>{t('saveStatus.detailsSafe')}</p>
          <div className={styles.popoverActions}>
            <button type="button" className={styles.action} onClick={() => { close(); saveElsewhere.run() }}>
              {saveElsewhere.label}
            </button>
            <button type="button" className={styles.primary} onClick={() => { close(); onRetry() }}>
              {t('saveStatus.retry')}
            </button>
          </div>
        </div>
      )}
    </span>
  )
}
