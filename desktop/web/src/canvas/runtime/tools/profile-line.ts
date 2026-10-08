// canvas/runtime/tools/profile-line.ts
//
// Owns the Profile tool (canopi-f47t.42, spec §1.10, §3.2, §3.7): a temporary multi-point line, Polygon's grammar without
// closing or fill, handed to the Site data profile through ToolEffects.finishProfile. Commit 0's stub with the final
// signature: armed, it draws nothing and hears every gesture as 'pass'; stream D builds the tool.

import type { CanvasTool } from './tool'

export function createProfileLineTool(): CanvasTool {
  return {
    id: 'profile',
    activate() {},
    gesture: () => 'pass',
    command: () => 'pass',
    hasTransient: () => false,
    cancelTransient() {},
    deactivate() {},
  }
}
