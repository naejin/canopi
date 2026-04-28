import { isSpeciesTarget, speciesTarget } from './panel-target-identity'
import type { BudgetItem, Consortium, PanelTarget, SpeciesPanelTarget, TimelineAction } from './types/design'

export function getConsortiumCanonicalName(entry: Consortium): string {
  return entry.target.canonical_name
}

export function consortiumTarget(canonicalName: string): SpeciesPanelTarget {
  return speciesTarget(canonicalName)
}

export function speciesBudgetTarget(canonicalName: string): SpeciesPanelTarget {
  return speciesTarget(canonicalName)
}

export function getBudgetHoverTarget(item: BudgetItem | null | undefined, canonicalName: string): PanelTarget {
  return item?.target ?? speciesBudgetTarget(canonicalName)
}

export function getTimelineHoverTargets(action: TimelineAction): readonly PanelTarget[] {
  return action.targets
}

export function getBudgetSpeciesTarget(item: BudgetItem): SpeciesPanelTarget | null {
  return item.category === 'plants' && isSpeciesTarget(item.target) ? item.target : null
}

export function getTimelineSpeciesTarget(action: TimelineAction): SpeciesPanelTarget | null {
  for (const target of action.targets) {
    if (isSpeciesTarget(target)) return target
  }
  return null
}
