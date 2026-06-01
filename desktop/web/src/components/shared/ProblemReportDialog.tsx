import { useEffect, useRef, useState } from 'preact/hooks'
import { problemReportDialogOpen } from '../../app/problem-report/state'
import { recentFrontendDiagnostics } from '../../app/problem-report/diagnostics'
import { buildCurrentDesignProblemReportAttachment } from '../../app/problem-report/attachments'
import { locale } from '../../app/settings/state'
import {
  createProblemReport,
  showProblemReportFolder,
  type ProblemReportRequest,
  type ProblemReportResult,
} from '../../ipc/problem-report'
import { t } from '../../i18n'
import styles from './ProblemReportDialog.module.css'

export function ProblemReportDialog() {
  if (!problemReportDialogOpen.value) return null
  return <ProblemReportDialogContent />
}

function ProblemReportDialogContent() {
  const [description, setDescription] = useState('')
  const [result, setResult] = useState<ProblemReportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [showFolderState, setShowFolderState] = useState<'idle' | 'showing' | 'failed'>('idle')
  const [includeCurrentDesign, setIncludeCurrentDesign] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  void locale.value

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  function closeDialog(): void {
    problemReportDialogOpen.value = false
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setCopyState('idle')

    try {
      const sensitiveAttachments: NonNullable<ProblemReportRequest['sensitive_attachments']> = {}
      const request: ProblemReportRequest = {
        description,
        frontend_diagnostics: recentFrontendDiagnostics(),
        sensitive_attachments: sensitiveAttachments,
      }
      if (includeCurrentDesign) {
        const currentDesign = buildCurrentDesignProblemReportAttachment()
        if (!currentDesign) {
          setError(t('problemReport.currentDesignUnavailable'))
          return
        }
        sensitiveAttachments.current_design = currentDesign
      }
      const next = await createProblemReport(request)
      setResult(next)
      setShowFolderState('idle')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSubmitting(false)
    }
  }

  async function copySummary(): Promise<void> {
    if (!result) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is not available')
      await navigator.clipboard.writeText(result.report_summary)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  async function showFolder(): Promise<void> {
    if (!result) return
    setShowFolderState('showing')
    try {
      await showProblemReportFolder(result.folder_path)
      setShowFolderState('idle')
    } catch {
      setShowFolderState('failed')
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeDialog()
    }
  }

  return (
    <div
      className={styles.overlay}
      onPointerUp={(event) => {
        if (event.target === event.currentTarget) closeDialog()
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="problem-report-title"
        data-preserve-overlays="true"
        onKeyDown={onKeyDown}
      >
        <header className={styles.header}>
          <div>
            <h2 id="problem-report-title" className={styles.title}>
              {t('problemReport.title')}
            </h2>
            <p className={styles.intro}>{t('problemReport.intro')}</p>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            onClick={closeDialog}
            aria-label={t('problemReport.close')}
          >
            ×
          </button>
        </header>

        {result ? (
          <div className={styles.success}>
            <h3 className={styles.sectionTitle}>{t('problemReport.successTitle')}</h3>
            <p className={styles.body}>{t('problemReport.successText')}</p>
            <dl className={styles.paths}>
              <div>
                <dt>{t('problemReport.folderPath')}</dt>
                <dd>{result.folder_path}</dd>
              </div>
              <div>
                <dt>{t('problemReport.summaryFile')}</dt>
                <dd>Report Summary.txt</dd>
              </div>
              <div>
                <dt>{t('problemReport.bundleFile')}</dt>
                <dd>Diagnostic Bundle.zip</dd>
              </div>
            </dl>
            <div className={styles.footer}>
              <button type="button" className={styles.secondaryButton} onClick={copySummary}>
                {t(copyState === 'copied' ? 'problemReport.copiedSummary' : 'problemReport.copySummary')}
              </button>
              <button type="button" className={styles.secondaryButton} onClick={closeDialog}>
                {t('problemReport.close')}
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void showFolder()}
                disabled={showFolderState === 'showing'}
              >
                {t(showFolderState === 'showing' ? 'problemReport.showingFolder' : 'problemReport.showFolder')}
              </button>
            </div>
            {copyState === 'failed' && (
              <p className={styles.errorText}>{t('problemReport.copyFailed')}</p>
            )}
            {showFolderState === 'failed' && (
              <p className={styles.errorText}>{t('problemReport.showFolderFailed')}</p>
            )}
          </div>
        ) : (
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <label className={styles.label} htmlFor="problem-report-description">
              {t('problemReport.descriptionLabel')}
            </label>
            <textarea
              id="problem-report-description"
              ref={textareaRef}
              className={styles.textarea}
              value={description}
              placeholder={t('problemReport.descriptionPlaceholder')}
              onInput={(event) => setDescription((event.target as HTMLTextAreaElement).value)}
            />
            <p className={styles.privacy}>{t('problemReport.privacyNote')}</p>
            <fieldset className={styles.attachments}>
              <legend>{t('problemReport.optionalAttachments')}</legend>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  name="include-current-design"
                  checked={includeCurrentDesign}
                  onChange={(event) =>
                    setIncludeCurrentDesign((event.target as HTMLInputElement).checked)
                  }
                />
                <span className={styles.checkboxText}>
                  <span className={styles.checkboxTitle}>
                    {t('problemReport.includeCurrentDesign')}
                  </span>
                  <span className={styles.checkboxDescription}>
                    {t('problemReport.includeCurrentDesignDescription')}
                  </span>
                </span>
              </label>
            </fieldset>
            {error && (
              <div className={styles.errorBox} role="alert">
                <strong>{t('problemReport.errorTitle')}</strong>
                <span>{error}</span>
              </div>
            )}
            <div className={styles.footer}>
              <button type="button" className={styles.secondaryButton} onClick={closeDialog}>
                {t('problemReport.cancel')}
              </button>
              <button type="submit" className={styles.primaryButton} disabled={submitting}>
                {t(submitting ? 'problemReport.creating' : 'problemReport.create')}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
