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

// A path token may contain spaces, so it runs to a delimiter or to a `: `
// separator; the error reason that usually follows a path stays readable.
const PATH_TOKEN = String.raw`(?:[^\n\r"')\]},;:]|:(?!\s|$))+`
const FILE_URL_PATH = new RegExp(String.raw`\bfile:\/\/\/${PATH_TOKEN}`, 'g')
const UNIX_PATH = new RegExp(String.raw`(^|[\s"'([{=])\/${PATH_TOKEN}`, 'g')
const WINDOWS_PATH = new RegExp(String.raw`(^|[\s"'([{=])[A-Za-z]:[\\/]${PATH_TOKEN}`, 'g')
// Credential query parameters such as the Google Maps `key=`.
const CREDENTIAL_QUERY_VALUE = /(^|[?&;\s])(key|api-key|api_key|apikey)=[^\s&#"')\]},;<>]+/gi

function sanitizeDiagnosticText(text: string): string {
  return text
    .replace(CREDENTIAL_QUERY_VALUE, '$1$2=<redacted>')
    .replace(FILE_URL_PATH, 'file://<path>')
    .replace(UNIX_PATH, '$1<path>')
    .replace(WINDOWS_PATH, '$1<path>')
}
