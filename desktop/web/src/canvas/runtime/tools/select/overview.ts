// canvas/runtime/tools/select/overview.ts
//
// Owns selection in overview (spec §3.2, "Overview"), which the ToolHost runs whatever tool is armed: plants are hidden
// and skipped by hit testing (HitFilter.overview), so a click selects the zone or note under them, a zone's fill
// included, and empty ground clears; a drag bands zones and notes. Shift or mod toggles or adds, Alt removes, a
// double-click is a click, and nothing moves, reshapes or opens for editing. The armed tool hears none of it.

import type { DraftPresentation } from '../draft'
import type { HitTarget, ToolPoint } from '../tool'
import { bandDraft, bandSelection, type Band } from './band'
import { clickSelection, pressSelection, type SelectionContext, type SelectPress } from './click'

const OVERVIEW_FILTER = { overview: true } as const

/** What the overview selector needs: selection, and the band's draft. */
type OverviewContext = SelectionContext & {
  readonly effects: SelectionContext['effects'] & { setDraft(draft: DraftPresentation | null): void }
}

interface OverviewSelector {
  /** `hit` is the press's hit with plants hidden. */
  press(point: ToolPoint, hit: HitTarget | null): void
  drag(point: ToolPoint): void
  /** The press's release, after a drag (`dragged`) or without one. */
  release(point: ToolPoint, dragged: boolean): void
  cancel(): void
}

export function createOverviewSelector(ctx: OverviewContext): OverviewSelector {
  let pressed: { readonly press: SelectPress; readonly band: Band | null } | null = null

  function end(): void {
    if (pressed?.band) ctx.effects.setDraft(null)
    pressed = null
  }

  return {
    press(point, hit) {
      const press = pressSelection(ctx, point, hit, 1, null, 0, OVERVIEW_FILTER)
      const band = press.kind === 'band' ? { start: point.world, additive: press.additive } : null
      pressed = { press, band }
      if (band) ctx.effects.setDraft(bandDraft(ctx.view, band, point.world))
    },
    drag(point) {
      if (pressed?.band) ctx.effects.setDraft(bandDraft(ctx.view, pressed.band, point.world))
    },
    release(point, dragged) {
      const current = pressed
      if (!current) return
      try {
        const selection = dragged && current.band ? bandSelection(ctx, current.band, point.world, OVERVIEW_FILTER) : null
        if (selection) ctx.effects.setSelection(selection)
        else if (!dragged) clickSelection(ctx, current.press)
      } finally {
        end()
      }
    },
    cancel: end,
  }
}
