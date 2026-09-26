import { computed, effect, untracked } from '@preact/signals'
import { canvasCommandDefinitions, type CanvasToolId } from '../canvas-commands'
import { currentCanvasTool } from '../../canvas/session'
import { mutateSettingsProjection } from '../settings/projection'
import { toolNamesVisible, usedCanvasTools } from '../settings/state'

/** Every tool on the rail; names show until each has been used once on this device. */
export const RAIL_TOOL_IDS: readonly CanvasToolId[] = canvasCommandDefinitions.flatMap(
  (definition) => definition.kind === 'tool' ? [definition.tool] : [],
)

/** Whether the tool rail shows names and keys: the View › Tool names choice, else first use. */
export const toolRailShowsNames = computed(() => {
  const choice = toolNamesVisible.value
  if (choice !== null) return choice
  const used = usedCanvasTools.value
  return !RAIL_TOOL_IDS.every((tool) => used.includes(tool))
})

/** View › Tool names: pins the current opposite, so the choice outlives first use. */
export function toggleToolNames(): void {
  const next = !toolRailShowsNames.peek()
  mutateSettingsProjection((draft) => {
    draft.toolRail.namesVisible = next
  }, { persist: 'immediate' })
}

export function recordCanvasToolUsed(tool: string): void {
  if (!(RAIL_TOOL_IDS as readonly string[]).includes(tool)) return
  if (usedCanvasTools.peek().includes(tool)) return
  mutateSettingsProjection((draft) => {
    draft.toolRail.usedTools = [...draft.toolRail.usedTools, tool]
  }, { persist: 'queued' })
}

let disposeActiveLearning: (() => void) | null = null

/**
 * Records each tool the first time it becomes active. The tool a canvas
 * starts with is not a use. Installed once per edition bootstrap.
 */
export function installToolRailLearning(): () => void {
  disposeActiveLearning?.()
  let previous = currentCanvasTool.peek()
  const stop = effect(() => {
    const tool = currentCanvasTool.value
    if (tool === previous) return
    previous = tool
    untracked(() => recordCanvasToolUsed(tool))
  })
  const dispose = (): void => {
    stop()
    if (disposeActiveLearning === dispose) disposeActiveLearning = null
  }
  disposeActiveLearning = dispose
  return dispose
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => disposeActiveLearning?.())
}
