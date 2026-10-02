import type { SceneRendererV2 } from '../../canvas/runtime/renderers/scene-types'
import type { DraftPresentation } from '../../canvas/runtime/tools/draft'
import type { ViewTransform } from '../../canvas/runtime/view/types'

export type RecordedRendererCall =
  | { readonly method: 'setDraft'; readonly draft: DraftPresentation | null }
  | { readonly method: 'setView'; readonly view: ViewTransform }

/**
 * The renderer's tool-facing entries, recorded in call order for tool and
 * ToolHost tests; it keeps each argument by reference and reads nothing from it.
 */
export interface RecordingRenderer extends Pick<SceneRendererV2, 'setDraft' | 'setView'> {
  readonly calls: readonly RecordedRendererCall[]
  /** The last draft set, or null when none was set since the start or the last `clear`. */
  lastDraft(): DraftPresentation | null
  lastView(): ViewTransform | null
  /** Forgets every recorded call. */
  clear(): void
}

export function createRecordingRenderer(): RecordingRenderer {
  const calls: RecordedRendererCall[] = []
  function last<M extends RecordedRendererCall['method']>(method: M): Extract<RecordedRendererCall, { method: M }> | undefined {
    for (let index = calls.length - 1; index >= 0; index -= 1) {
      const call = calls[index]!
      if (call.method === method) return call as Extract<RecordedRendererCall, { method: M }>
    }
    return undefined
  }
  return {
    calls,
    setDraft(draft) {
      calls.push({ method: 'setDraft', draft })
    },
    setView(view) {
      calls.push({ method: 'setView', view })
    },
    lastDraft: () => last('setDraft')?.draft ?? null,
    lastView: () => last('setView')?.view ?? null,
    clear() {
      calls.length = 0
    },
  }
}
