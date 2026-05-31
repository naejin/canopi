import { getCurrentCanvasDocumentSurface } from '../../canvas/session'
import { buildPersistedDesignSessionContent } from '../document-session/persistence'
import { designSessionStore } from '../document-session/store'

export function buildCurrentDesignProblemReportAttachment(): string | null {
  if (!designSessionStore.hasCurrentDesign()) return null

  const file = buildPersistedDesignSessionContent({
    session: getCurrentCanvasDocumentSurface(),
    name: designSessionStore.readDesignName(),
  })
  return `${JSON.stringify(file, null, 2)}\n`
}
