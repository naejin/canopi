import type { PlacedPlant } from '../../types/design'

export type ActionType = 'planting' | 'pruning' | 'harvest' | 'watering' | 'fertilising' | 'other'
export const ACTION_TYPES: readonly ActionType[] = ['planting', 'pruning', 'harvest', 'watering', 'fertilising', 'other']

export interface TimelineSpeciesOption {
  readonly canonical_name: string
  readonly display_name: string
}

export function buildTimelineSpeciesOptions(
  plants: readonly PlacedPlant[],
  localizedNames: ReadonlyMap<string, string | null> | undefined,
  locale: string,
): TimelineSpeciesOption[] {
  const seen = new Set<string>()
  const result: TimelineSpeciesOption[] = []

  for (const plant of plants) {
    if (seen.has(plant.canonical_name)) continue
    seen.add(plant.canonical_name)
    result.push({
      canonical_name: plant.canonical_name,
      display_name: localizedNames?.get(plant.canonical_name) ?? plant.common_name ?? plant.canonical_name,
    })
  }

  result.sort((left, right) => left.display_name.localeCompare(right.display_name, locale))
  return result
}
