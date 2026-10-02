// app/keyboard/arming.ts
//
// The one way app code arms a canvas tool (spec §1.6, policy P9). Each caller passes its own `from`: the rail, menus,
// palette and both editions' keys reach here through the shared canvas dispatch (dispatchCanvasCommandIntent, the
// intent adapter's selectTool, runCatalogCommand and the projected action(from)); a catalog panel's Place, Favorites'
// Place stamp, the tool card's stamp chooser and the Start card call it directly. Arming writes the source to the
// module read models first (canvas/plant-stamp-source.ts, canvas/saved-object-stamp-source.ts: what the tool card,
// recents and choosers show, and what the session reads when the tool activates), selects the canvas panel for the
// command and Start-card callers, sets the tool on the live canvas session and focuses the map for every `from` but a
// shortcut, which leaves focus where it is. A drop arms in the runtime, with no `from`. Rail learning is not recorded
// here: it stays an effect on every tool change (app/tool-rail/learning.ts).

import type { CanvasCommandFrom } from '../canvas-commands'
import type { ToolId } from '../../canvas/runtime/interaction-types'
import type { ToolSource } from '../../canvas/runtime/tools/tool'
import { selectPlantStampSource } from '../../canvas/plant-stamp-source'
import { selectSavedObjectStampSource } from '../../canvas/saved-object-stamp-source'
import { currentCanvasToolCommandSurface, setCurrentCanvasTool } from '../../canvas/session'
import { activePanel, selectPanel } from '../shell/state'
import { focusOwner } from './focus-owner'

/** Who armed the tool: a command surface (CanvasCommandFrom), a panel's Place, the tool card or the Start card. */
export type ArmFrom = CanvasCommandFrom | 'panel' | 'card' | 'start-card'

/** True when a canvas session took the tool. */
export function armCanvasTool(
  tool: ToolId,
  options: { readonly from: ArmFrom; readonly source?: ToolSource },
): boolean {
  const { from, source } = options
  const command = from !== 'panel' && from !== 'card'
  // The command and Start-card callers bring the map forward; Place plants arms without a species too (its card offers
  // the chooser).
  if (command && activePanel.peek() !== 'canvas') selectPanel('canvas')
  const tools = currentCanvasToolCommandSurface.peek()
  if (source?.kind === 'species') {
    // Kept with no canvas too: Place plants' chooser offers it again.
    selectPlantStampSource(source.species)
  } else if (source?.kind === 'saved-stamp' && tools) {
    selectSavedObjectStampSource(source.stamp, source.name ?? null)
  }
  if (!tools) {
    // Before the canvas mounts, a command primes the tool it starts with; a panel or the card arms nothing.
    if (command) setCurrentCanvasTool(tool)
    return false
  }
  // Never short-circuited for the tool already armed: arming it again takes the new source (and Copy an object on the
  // map arms Select, then Place a stamp, to drop the stamp it held).
  setCurrentCanvasTool(tool)
  if (from !== 'shortcut') focusOwner.focusMap('tool-armed')
  return true
}
