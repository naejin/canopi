// canvas/runtime/tools/pan.ts
//
// Owns the Pan tool ('hand', key H; spec §1.4, §3.2), which holds nothing: the host's cursor table gives it 'grab' and its
// guidance stays empty. Its drags never reach it, since the recogniser turns a primary drag under the Pan tool into a `pan`
// for the view's navigation; the press still reaches the host and ends with a `tap`, or with cancel('navigate') after its
// drag panned (spec §2.2), and the tool ignores them all.
// No handles show while Pan is armed and a Pan-tool click never samples an inspected raster (the host's rules).

import type { CanvasTool } from './tool'

export function createPanTool(): CanvasTool {
  return {
    id: 'hand',
    activate() {},
    gesture: () => 'pass',
    command: () => 'pass',
    hasTransient: () => false,
    escapeHint: () => 'leave-tool',
    cancelTransient() {},
    deactivate() {},
  }
}
