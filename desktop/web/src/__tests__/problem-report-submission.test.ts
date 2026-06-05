import { describe, expect, it, vi } from 'vitest'
import {
  createProblemReportSubmission,
  type ProblemReportSubmissionDeps,
} from '../app/problem-report/submission'

function createDeps(overrides: Partial<ProblemReportSubmissionDeps> = {}): ProblemReportSubmissionDeps {
  return {
    createProblemReport: vi.fn().mockResolvedValue({
      folder_path: '/tmp/Canopi Problem Report',
      summary_path: '/tmp/Canopi Problem Report/Report Summary.txt',
      bundle_path: '/tmp/Canopi Problem Report/Diagnostic Bundle.zip',
      report_summary: 'Canopi Problem Report',
    }),
    showProblemReportFolder: vi.fn().mockResolvedValue(undefined),
    readFrontendDiagnostics: vi.fn(() => [
      {
        level: 'error',
        source: 'command:Open design',
        message: 'disk failed at <path>',
        timestamp_ms: 1,
      },
    ]),
    buildCurrentDesignAttachment: vi.fn(() => 'current design json'),
    writeClipboardText: vi.fn().mockResolvedValue(undefined),
    currentDesignUnavailableMessage: () => 'Current Design is unavailable',
    setDialogOpen: vi.fn(),
    ...overrides,
  }
}

describe('Problem Report submission module', () => {
  it('submits recent diagnostics and excludes current Design contents by default', async () => {
    const deps = createDeps()
    const submission = createProblemReportSubmission(deps)

    submission.setDescription('Canvas froze after placing a species')
    await submission.submit()

    expect(deps.createProblemReport).toHaveBeenCalledWith({
      description: 'Canvas froze after placing a species',
      frontend_diagnostics: [
        expect.objectContaining({
          message: 'disk failed at <path>',
        }),
      ],
      sensitive_attachments: {},
    })
    expect(deps.buildCurrentDesignAttachment).not.toHaveBeenCalled()
    expect(submission.result.value?.bundle_path).toContain('Diagnostic Bundle.zip')
    expect(submission.error.value).toBeNull()
  })

  it('includes current Design contents only after explicit opt-in', async () => {
    const deps = createDeps()
    const submission = createProblemReportSubmission(deps)

    submission.setIncludeCurrentDesign(true)
    await submission.submit()

    expect(deps.buildCurrentDesignAttachment).toHaveBeenCalledOnce()
    expect(deps.createProblemReport).toHaveBeenCalledWith(expect.objectContaining({
      sensitive_attachments: {
        current_design: 'current design json',
      },
    }))
  })

  it('blocks submission when current Design is selected but unavailable', async () => {
    const deps = createDeps({
      buildCurrentDesignAttachment: vi.fn(() => null),
    })
    const submission = createProblemReportSubmission(deps)

    submission.setIncludeCurrentDesign(true)
    await submission.submit()

    expect(deps.createProblemReport).not.toHaveBeenCalled()
    expect(submission.error.value).toBe('Current Design is unavailable')
    expect(submission.submitting.value).toBe(false)
  })

  it('copies the generated summary and reveals the generated folder through commands', async () => {
    const deps = createDeps()
    const submission = createProblemReportSubmission(deps)

    await submission.submit()
    await submission.copySummary()
    await submission.showFolder()

    expect(deps.writeClipboardText).toHaveBeenCalledWith('Canopi Problem Report')
    expect(submission.copyState.value).toBe('copied')
    expect(deps.showProblemReportFolder).toHaveBeenCalledWith('/tmp/Canopi Problem Report')
    expect(submission.showFolderState.value).toBe('idle')
  })

  it('closes and resets dialog state through the module', async () => {
    const deps = createDeps()
    const submission = createProblemReportSubmission(deps)

    submission.open()
    submission.setDescription('Canvas froze')
    submission.setIncludeCurrentDesign(true)
    await submission.submit()
    submission.close()

    expect(deps.setDialogOpen).toHaveBeenLastCalledWith(false)
    expect(submission.description.value).toBe('')
    expect(submission.includeCurrentDesign.value).toBe(false)
    expect(submission.result.value).toBeNull()
  })
})
