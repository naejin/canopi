import type { BudgetItem, Consortium, PanelTarget, SpeciesPanelTarget, TimelineAction } from './types/design'

export const MANUAL_TARGET: PanelTarget = { kind: 'manual' }
export const NONE_TARGET: PanelTarget = { kind: 'none' }

export function speciesTarget(canonicalName: string): SpeciesPanelTarget {
  return { kind: 'species', canonical_name: canonicalName }
}

export function panelTargetKey(target: PanelTarget): string {
  switch (target.kind) {
    case 'placed_plant':
      return `placed_plant:${target.plant_id}`
    case 'species':
      return `species:${target.canonical_name}`
    case 'zone':
      return `zone:${target.zone_name}`
    case 'manual':
      return 'manual'
    case 'none':
      return 'none'
  }
}

export function panelTargetsEqual(left: readonly PanelTarget[], right: readonly PanelTarget[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (panelTargetKey(left[i]!) !== panelTargetKey(right[i]!)) return false
  }
  return true
}

export function panelTargetEqual(left: PanelTarget, right: PanelTarget): boolean {
  return panelTargetKey(left) === panelTargetKey(right)
}

export function isSpeciesTarget(target: PanelTarget): target is SpeciesPanelTarget {
  return target.kind === 'species'
}

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
  return item.category === 'plants' && item.target.kind === 'species' ? item.target : null
}

export function getTimelineSpeciesTarget(action: TimelineAction): SpeciesPanelTarget | null {
  for (const target of action.targets) {
    if (target.kind === 'species') return target
  }
  return null
}
