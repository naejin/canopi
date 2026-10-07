import type { SceneRenderTarget } from '../../canvas/runtime/renderers/scene-types'
import type { DraftPresentation } from '../../canvas/runtime/tools/draft'

export type RecordedRendererCall = { readonly method: 'setDraft'; readonly draft: DraftPresentation | null }

/**
 * The render target's tool-facing entry, recorded in call order for tool and
 * ToolHost tests; it keeps each argument by reference and reads nothing from it.
 */
export interface RecordingRenderer extends Pick<SceneRenderTarget, 'setDraft'> {
  readonly calls: readonly RecordedRendererCall[]
  /** The last draft set, or null when none was set since the start or the last `clear`. */
  lastDraft(): DraftPresentation | null
  /** Forgets every recorded call. */
  clear(): void
}

export function createRecordingRenderer(): RecordingRenderer {
  const calls: RecordedRendererCall[] = []
  return {
    calls,
    setDraft(draft) {
      calls.push({ method: 'setDraft', draft })
    },
    lastDraft: () => calls.at(-1)?.draft ?? null,
    clear() {
      calls.length = 0
    },
  }
}
