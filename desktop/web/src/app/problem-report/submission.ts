import { signal, type Signal } from '@preact/signals'
import {
  createProblemReport,
  showProblemReportFolder,
  type ProblemReportRequest,
  type ProblemReportResult,
} from '../../ipc/problem-report'
import { t } from '../../i18n'
import { recentFrontendDiagnostics } from './diagnostics'
import { buildCurrentDesignProblemReportAttachment } from './attachments'
import { problemReportDialogOpen } from './state'

export type ProblemReportCopyState = 'idle' | 'copied' | 'failed'
export type ProblemReportShowFolderState = 'idle' | 'showing' | 'failed'

export interface ProblemReportSubmissionDeps {
  readonly createProblemReport: (request: ProblemReportRequest) => Promise<ProblemReportResult>
  readonly showProblemReportFolder: (folderPath: string) => Promise<void>
  readonly readFrontendDiagnostics: typeof recentFrontendDiagnostics
  readonly buildCurrentDesignAttachment: () => string | null
  readonly writeClipboardText: (text: string) => Promise<void>
  readonly currentDesignUnavailableMessage: () => string
  readonly setDialogOpen: (open: boolean) => void
}

export interface ProblemReportSubmission {
  readonly description: Signal<string>
  readonly includeCurrentDesign: Signal<boolean>
  readonly submitting: Signal<boolean>
  readonly result: Signal<ProblemReportResult | null>
  readonly error: Signal<string | null>
  readonly copyState: Signal<ProblemReportCopyState>
  readonly showFolderState: Signal<ProblemReportShowFolderState>
  open(): void
  close(): void
  reset(): void
  setDescription(description: string): void
  setIncludeCurrentDesign(include: boolean): void
  submit(): Promise<void>
  copySummary(): Promise<void>
  showFolder(): Promise<void>
}

const DEFAULT_DEPS: ProblemReportSubmissionDeps = {
  createProblemReport,
  showProblemReportFolder,
  readFrontendDiagnostics: recentFrontendDiagnostics,
  buildCurrentDesignAttachment: buildCurrentDesignProblemReportAttachment,
  writeClipboardText: async (text) => {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard is not available')
    await navigator.clipboard.writeText(text)
  },
  currentDesignUnavailableMessage: () => t('problemReport.currentDesignUnavailable'),
  setDialogOpen: (open) => {
    problemReportDialogOpen.value = open
  },
}

export const problemReportSubmission = createProblemReportSubmission(DEFAULT_DEPS)

export function openProblemReportDialog(): void {
  problemReportSubmission.open()
}

export function createProblemReportSubmission(
  deps: ProblemReportSubmissionDeps,
): ProblemReportSubmission {
  const description = signal('')
  const includeCurrentDesign = signal(false)
  const submitting = signal(false)
  const result = signal<ProblemReportResult | null>(null)
  const error = signal<string | null>(null)
  const copyState = signal<ProblemReportCopyState>('idle')
  const showFolderState = signal<ProblemReportShowFolderState>('idle')

  function reset(): void {
    description.value = ''
    includeCurrentDesign.value = false
    submitting.value = false
    result.value = null
    error.value = null
    copyState.value = 'idle'
    showFolderState.value = 'idle'
  }

  return {
    description,
    includeCurrentDesign,
    submitting,
    result,
    error,
    copyState,
    showFolderState,
    open() {
      reset()
      deps.setDialogOpen(true)
    },
    close() {
      deps.setDialogOpen(false)
      reset()
    },
    reset,
    setDescription(nextDescription) {
      description.value = nextDescription
    },
    setIncludeCurrentDesign(include) {
      includeCurrentDesign.value = include
    },
    async submit() {
      submitting.value = true
      error.value = null
      copyState.value = 'idle'

      try {
        const sensitiveAttachments: NonNullable<ProblemReportRequest['sensitive_attachments']> = {}
        if (includeCurrentDesign.value) {
          const currentDesign = deps.buildCurrentDesignAttachment()
          if (!currentDesign) {
            error.value = deps.currentDesignUnavailableMessage()
            return
          }
          sensitiveAttachments.current_design = currentDesign
        }

        result.value = await deps.createProblemReport({
          description: description.value,
          frontend_diagnostics: deps.readFrontendDiagnostics(),
          sensitive_attachments: sensitiveAttachments,
        })
        showFolderState.value = 'idle'
      } catch (caught) {
        error.value = caught instanceof Error ? caught.message : String(caught)
      } finally {
        submitting.value = false
      }
    },
    async copySummary() {
      if (!result.value) return
      try {
        await deps.writeClipboardText(result.value.report_summary)
        copyState.value = 'copied'
      } catch {
        copyState.value = 'failed'
      }
    },
    async showFolder() {
      if (!result.value) return
      showFolderState.value = 'showing'
      try {
        await deps.showProblemReportFolder(result.value.folder_path)
        showFolderState.value = 'idle'
      } catch {
        showFolderState.value = 'failed'
      }
    },
  }
}
