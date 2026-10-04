import type { PlantSymbolId } from '../../canvas/runtime/scene'

/** A catalog species without plants in the Design takes the symbol of its growth habit. */
const HABIT_SYMBOLS: Readonly<Record<string, PlantSymbolId>> = {
  Tree: 'canopy',
  Shrub: 'shrub',
  Herbaceous: 'herb',
  Climber: 'climber',
}

/** The muted glyph for a catalog habit key (`Tree`, `Shrub`, …); a plain mark when unknown. */
export function catalogHabitSymbol(habit: string | null | undefined): PlantSymbolId {
  return HABIT_SYMBOLS[habit ?? ''] ?? 'round'
}
