import type { SceneRenderTarget } from '../../canvas/runtime/renderers/scene-types'
import type { DraftPresentation } from '../../canvas/runtime/tools/draft'

/**
 * The render target's tool-facing entry, recorded in call order for tool and
 * ToolHost tests; it keeps each draft by reference and reads nothing from it.
 */
export interface RecordingRenderer extends Pick<SceneRenderTarget, 'setDraft'> {
  readonly drafts: readonly (DraftPresentation | null)[]
  /** The last draft set, or null when none was set since the start or the last `clear`. */
  lastDraft(): DraftPresentation | null
  /** Forgets every recorded draft. */
  clear(): void
}

export function createRecordingRenderer(): RecordingRenderer {
  const drafts: (DraftPresentation | null)[] = []
  return {
    drafts,
    setDraft(draft) {
      drafts.push(draft)
    },
    lastDraft: () => drafts.at(-1) ?? null,
    clear() {
      drafts.length = 0
    },
  }
}
