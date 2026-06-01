import type { FrontendDiagnosticEntry } from '../../generated/contracts'

type FrontendDiagnosticLevel = 'error' | 'warning' | 'info'

interface RecordFrontendDiagnosticInput {
  readonly level: FrontendDiagnosticLevel
  readonly source: string
  readonly message: string
}

const MAX_FRONTEND_DIAGNOSTICS = 50

let diagnostics: FrontendDiagnosticEntry[] = []

export function recordFrontendDiagnostic(input: RecordFrontendDiagnosticInput): void {
  diagnostics = [
    ...diagnostics,
    {
      level: input.level,
      source: sanitizeDiagnosticText(input.source),
      message: sanitizeDiagnosticText(input.message),
      timestamp_ms: Date.now(),
    },
  ].slice(-MAX_FRONTEND_DIAGNOSTICS)
}

export function recentFrontendDiagnostics(): FrontendDiagnosticEntry[] {
  return diagnostics.map((entry) => ({ ...entry }))
}

export function diagnosticMessageFromError(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message
  return String(error)
}

export function resetFrontendDiagnosticsForTests(): void {
  diagnostics = []
}

function sanitizeDiagnosticText(text: string): string {
  return text
    .replace(/\bfile:\/\/\/[^\n\r"')\]},;]+/g, 'file://<path>')
    .replace(/(^|[\s"'([{=])\/[^\n\r"')\]},;]+/g, '$1<path>')
    .replace(/(^|[\s"'([{=])[A-Za-z]:[\\/][^\n\r"')\]},;]+/g, '$1<path>')
}
