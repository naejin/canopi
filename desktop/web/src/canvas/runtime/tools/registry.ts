// canvas/runtime/tools/registry.ts
//
// Owns which tools the ToolHost runs: one factory per tool id. A tool that is not listed runs through the legacy bridge
// (interaction/tool-modules.ts) until its stream moves it here in 0B-3 (plan §4 0B); ToolHost.isRegistered reads this list,
// and the host's shared duties switch on it (spec §1.4, "The legacy bridge").

import type { ToolId } from '../interaction-types'
import { createPanTool } from './pan'
import type { CanvasTool } from './tool'

export type ToolFactory = () => CanvasTool

export const TOOL_REGISTRY: Readonly<Partial<Record<ToolId, ToolFactory>>> = Object.freeze({
  hand: createPanTool,
})
