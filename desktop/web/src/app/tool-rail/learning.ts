import { computed, effect, untracked } from '@preact/signals'
import { canvasCommandDefinitions, type CanvasToolId } from '../canvas-commands'
import { currentCanvasTool } from '../../canvas/session'
import { mutateSettingsProjection } from '../settings/projection'
import { toolNamesVisible, usedCanvasTools } from '../settings/state'
import { toolRailCrowdsMap, visibleMapFrame } from '../shell/visible-map-area'

/**
 * Every tool on the main rail; names show until each has been used once on this device. Pan is not on it: it lives in
 * View and Tools, the palette, H and the phone strip.
 */
export const RAIL_TOOL_IDS: readonly CanvasToolId[] = canvasCommandDefinitions.flatMap(
  (definition) => definition.kind === 'tool' && definition.tool !== 'hand' ? [definition.tool] : [],
)

/** Whether the tool rail shows names and keys: the View › Tool names choice, else first use. */
export const toolRailShowsNames = computed(() => {
  const choice = toolNamesVisible.value
  if (choice !== null) return choice
  const used = usedCanvasTools.value
  return !RAIL_TOOL_IDS.every((tool) => used.includes(tool))
})

/**
 * Whether the rail shows names on this map: the setting above, unless the
 * labelled rail would leave too little map beside the right chrome (a narrow
 * window with a dock open). Then it keeps to icons with labelled tooltips.
 */
export const toolRailShowsNamesOnMap = computed(() => (
  toolRailShowsNames.value && !toolRailCrowdsMap(visibleMapFrame.value, labelledToolRailEdgePx())
))

/** Where the labelled rail's right edge sits from the map's left edge: `--chrome-inset` + `--chrome-rail-named-width`. */
function labelledToolRailEdgePx(): number {
  const style = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement)
  const length = (name: string, fallback: number) => {
    const value = Number.parseFloat(style?.getPropertyValue(name) ?? '')
    return Number.isFinite(value) ? value : fallback
  }
  // Fallbacks mirror styles/global.css for environments without its tokens.
  return length('--chrome-inset', 12) + length('--chrome-rail-named-width', 224)
}

/** View › Tool names: pins the current opposite, so the choice outlives first use. */
export function toggleToolNames(): void {
  const next = !toolRailShowsNames.peek()
  mutateSettingsProjection((draft) => {
    draft.toolRail.namesVisible = next
  }, { persist: 'immediate' })
}

function recordCanvasToolUsed(tool: string): void {
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
