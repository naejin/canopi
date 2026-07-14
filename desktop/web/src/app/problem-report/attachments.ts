import { captureCurrentDesignObservation } from '../document-session/transition'

export function buildCurrentDesignProblemReportAttachment(): string | null {
  const file = captureCurrentDesignObservation()
  return file ? `${JSON.stringify(file, null, 2)}\n` : null
}
