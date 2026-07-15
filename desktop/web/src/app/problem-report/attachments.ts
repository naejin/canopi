import { captureCurrentDesignObservation } from '../document-session/transition'
import { encodeCanopiDesign } from '../contracts/canopi-design-wire'

export function buildCurrentDesignProblemReportAttachment(): string | null {
  const file = captureCurrentDesignObservation()
  return file ? `${JSON.stringify(encodeCanopiDesign(file), null, 2)}\n` : null
}
