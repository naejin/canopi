import { useMemo } from 'preact/hooks'
import { PLANT_DISPLAY_STRATA, type PlantDisplayStratum } from '../../canvas/runtime/plant-display'
import { currentDesign } from '../document-session/store'
import { designStrata } from '../plant-display/state'
import { useCatalogHabits } from './catalog-forms'

/**
 * The finder's Stratum and Form quick filters. Stratum is the Design's own, as Consortium
 * assigns it (`none`: no stratum yet), never the catalog's; Form is the catalog habit
 * (`none`: not recorded). Counts cover every species of the list, whatever else filters
 * it, and a list keeps only the species in `allowed`, as it does with the matcher's keys.
 */
export type SpeciesStratumChoice = PlantDisplayStratum | 'none'
export type SpeciesFormChoice = 'tree' | 'shrub' | 'herbaceous' | 'climber' | 'none'

export const SPECIES_STRATUM_CHOICES: readonly SpeciesStratumChoice[] = [...PLANT_DISPLAY_STRATA, 'none']
export const SPECIES_FORM_CHOICES: readonly SpeciesFormChoice[] = ['tree', 'shrub', 'herbaceous', 'climber', 'none']

export interface SpeciesQuickFilterValue {
  readonly stratum: SpeciesStratumChoice | null
  readonly form: SpeciesFormChoice | null
}

export const NO_SPECIES_QUICK_FILTERS: SpeciesQuickFilterValue = { stratum: null, form: null }

export interface SpeciesQuickFilters {
  readonly value: SpeciesQuickFilterValue
  /** Species passing the chosen filters, in list order; null while none is chosen. */
  readonly allowed: ReadonlySet<string> | null
  /** Species per stratum, in stratum order, only for strata the list has. */
  readonly stratumCounts: ReadonlyMap<SpeciesStratumChoice, number>
  /** Species per form, in form order, only for forms the list has; species still loading are left out. */
  readonly formCounts: ReadonlyMap<SpeciesFormChoice, number>
}

export function catalogForm(habit: string | null | undefined): SpeciesFormChoice {
  const form = habit?.trim().toLowerCase()
  return form === 'tree' || form === 'shrub' || form === 'herbaceous' || form === 'climber' ? form : 'none'
}

export function speciesQuickFilters(
  canonicalNames: readonly string[],
  value: SpeciesQuickFilterValue,
  strata: ReadonlyMap<string, SpeciesStratumChoice>,
  forms: ReadonlyMap<string, SpeciesFormChoice>,
): SpeciesQuickFilters {
  const stratumOf = (name: string): SpeciesStratumChoice => strata.get(name) ?? 'none'
  const stratumCounts = countBy(canonicalNames, SPECIES_STRATUM_CHOICES, stratumOf)
  const formCounts = countBy(canonicalNames.filter((name) => forms.has(name)), SPECIES_FORM_CHOICES, (name) => forms.get(name)!)
  const allowed = value.stratum === null && value.form === null
    ? null
    : new Set(canonicalNames.filter((name) => (
      (value.stratum === null || stratumOf(name) === value.stratum)
      && (value.form === null || forms.get(name) === value.form)
    )))
  return { value, allowed, stratumCounts, formCounts }
}

/** The quick filters over a list's species: Design strata from the open Design, forms from the catalog. */
export function useSpeciesQuickFilters(
  canonicalNames: readonly string[],
  value: SpeciesQuickFilterValue,
): SpeciesQuickFilters {
  const design = currentDesign.value
  const strata = useMemo(() => designStrata(design), [design])
  const habits = useCatalogHabits(canonicalNames)
  const forms = useMemo(() => new Map([...habits].map(([name, habit]) => [name, catalogForm(habit)])), [habits])
  return useMemo(
    () => speciesQuickFilters(canonicalNames, value, strata, forms),
    [canonicalNames, forms, strata, value],
  )
}

function countBy<K>(names: readonly string[], order: readonly K[], keyOf: (name: string) => K): ReadonlyMap<K, number> {
  const counts = new Map<K, number>()
  for (const name of names) counts.set(keyOf(name), (counts.get(keyOf(name)) ?? 0) + 1)
  return new Map(order.filter((key) => counts.has(key)).map((key) => [key, counts.get(key)!]))
}
