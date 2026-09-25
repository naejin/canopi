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

  it('keeps the error reason that follows a redacted path', () => {
    recordFrontendDiagnostic({
      level: 'error',
      source: 'command:Open design',
      message: 'Failed to read /media/alice/USB Drive/Secret Orchard.canopi: No such file or directory',
    })
    recordFrontendDiagnostic({
      level: 'error',
      source: 'command:Save design',
      message: String.raw`Failed to save C:\Users\alice\Secret Orchard.canopi: Access is denied.`,
    })

    const [unix, windows] = recentFrontendDiagnostics()

    expect(unix!.message).toBe('Failed to read <path>: No such file or directory')
    expect(windows!.message).toBe('Failed to save <path>: Access is denied.')
  })

  it('redacts credential query values', () => {
    recordFrontendDiagnostic({
      level: 'error',
      source: 'satellite',
      message: 'GET https://tile.googleapis.com/v1/createSession?key=AIzaSECRET&session=abc failed; api-key=SECRET2',
    })

    const [entry] = recentFrontendDiagnostics()

    expect(entry!.message).not.toContain('SECRET')
    expect(entry!.message).toContain('?key=<redacted>&session=abc')
    expect(entry!.message).toContain('api-key=<redacted>')
  })
})
