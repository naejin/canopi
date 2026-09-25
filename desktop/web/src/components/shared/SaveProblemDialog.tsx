import { useEffect, useRef } from 'preact/hooks'
import {
  answerSaveProblem,
  saveProblem,
  type SaveProblemChoice,
  type SaveProblemRequest,
} from '../../app/document-session/save-problem'
import { t } from '../../i18n'
import styles from './save-problem-dialog.module.css'

interface DialogAction {
  readonly choice: SaveProblemChoice
  readonly label: string
  readonly tone: 'primary' | 'danger' | 'neutral'
}

/** The single continuous-save dialog, shared by the Desktop and Web shells. */
export function SaveProblemDialog() {
  const request = saveProblem.value
  if (!request) return null
  return <SaveProblemDialogContent request={request} />
}

function SaveProblemDialogContent({ request }: { readonly request: SaveProblemRequest }) {
  const firstActionRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    firstActionRef.current?.focus()
  }, [request])
  const { title, message, actions } = describe(request)

  return (
    <div className={styles.overlay}>
      <section
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="save-problem-title"
        aria-describedby="save-problem-message"
        data-preserve-overlays="true"
        data-save-problem={request.kind}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          answerSaveProblem('cancel')
        }}
      >
        <h2 id="save-problem-title" className={styles.title}>{title}</h2>
        <p id="save-problem-message" className={styles.message}>{message}</p>
        <footer className={styles.footer}>
          {actions.map((action, index) => (
            <button
              key={action.choice}
              ref={index === 0 ? firstActionRef : undefined}
              type="button"
              className={`${styles.button} ${styles[action.tone]}`}
              data-save-problem-choice={action.choice}
              onClick={() => answerSaveProblem(action.choice)}
            >
              {action.label}
            </button>
          ))}
        </footer>
      </section>
    </div>
  )
}

function describe(request: SaveProblemRequest): {
  readonly title: string
  readonly message: string
  readonly actions: readonly DialogAction[]
} {
  const cancel: DialogAction = { choice: 'cancel', label: t('canvas.file.cancel'), tone: 'neutral' }
  if (request.kind === 'revert') {
    // Cancel first: it takes focus, so Enter never discards changes by accident.
    return {
      title: t('saveProblem.revertTitle'),
      message: t('saveProblem.revertMessage'),
      actions: [cancel, { choice: 'revert', label: t('saveProblem.revertConfirm'), tone: 'danger' }],
    }
  }
  if (request.kind === 'flush-failed') {
    const discard: DialogAction = {
      choice: 'discard',
      label: t(request.purpose === 'close' ? 'saveProblem.closeWithoutSaving' : 'saveProblem.discard'),
      tone: 'danger',
    }
    if (request.conflict) {
      return {
        title: t('saveProblem.flushFailedTitle'),
        message: t('saveProblem.conflictPendingMessage'),
        actions: [cancel, discard],
      }
    }
    return {
      title: t('saveProblem.flushFailedTitle'),
      message: t(request.purpose === 'close'
        ? 'saveProblem.flushFailedCloseMessage'
        : 'saveProblem.flushFailedMessage'),
      actions: [{ choice: 'retry', label: t('saveProblem.retry'), tone: 'primary' }, discard, cancel],
    }
  }
  if (request.fileGone) {
    return {
      title: t('saveProblem.fileGoneTitle'),
      message: t('saveProblem.fileGoneMessage'),
      actions: [
        { choice: 'save-copy', label: t('saveProblem.saveElsewhere'), tone: 'primary' },
        { choice: 'keep-mine', label: t('saveProblem.keepMine'), tone: 'neutral' },
        cancel,
      ],
    }
  }
  return {
    title: t('saveProblem.conflictTitle'),
    message: t('saveProblem.conflictMessage'),
    actions: [
      { choice: 'keep-mine', label: t('saveProblem.keepMine'), tone: 'primary' },
      { choice: 'use-file', label: t('saveProblem.useFile'), tone: 'danger' },
      { choice: 'save-copy', label: t('saveProblem.saveCopy'), tone: 'neutral' },
      cancel,
    ],
  }
}
