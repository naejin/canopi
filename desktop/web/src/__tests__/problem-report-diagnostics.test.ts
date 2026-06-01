import { beforeEach, describe, expect, it } from 'vitest'
import {
  recordFrontendDiagnostic,
  recentFrontendDiagnostics,
  resetFrontendDiagnosticsForTests,
} from '../app/problem-report/diagnostics'

describe('frontend problem-report diagnostics', () => {
  beforeEach(() => {
    resetFrontendDiagnosticsForTests()
  })

  it('keeps a bounded sanitized buffer of recent frontend diagnostics', () => {
    for (let index = 0; index < 60; index += 1) {
      recordFrontendDiagnostic({
        level: 'error',
        source: 'command:Open design',
        message: `Failed at /home/alice/Secret Garden/design-${index}.canopi`,
      })
    }

    const diagnostics = recentFrontendDiagnostics()

    expect(diagnostics).toHaveLength(50)
    expect(diagnostics[0]!.message).toContain('<path>')
    expect(diagnostics[0]!.message).not.toContain('/home/alice')
    expect(diagnostics[49]!.message).not.toContain('Secret Garden')
    expect(diagnostics[49]!.message).not.toContain('design-59.canopi')
    expect(diagnostics[49]!.source).toBe('command:Open design')
  })
})
