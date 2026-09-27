import {
  resolvePlantSymbolForPlant,
  type PlantSymbolId,
  type ScenePersistedState,
} from './scene'
import { resolvePlantBaseColor } from './plant-presentation'
import type { SpeciesCacheEntry } from './species-cache'

const EMPTY_SPECIES_CACHE = new Map<string, SpeciesCacheEntry>()

/** A species' symbol and colour on the map. */
export interface SpeciesAppearance {
  readonly symbol: PlantSymbolId
  readonly color: string
}

/**
 * The symbol and colour a new plant of this species takes in this Design:
 * the Design's species symbol and colour, else the default symbol and the
 * stratum colour. The same rules as a placed plant without overrides.
 */
export function speciesPlacementAppearance(
  scene: Pick<ScenePersistedState, 'plantSpeciesSymbols' | 'plantSpeciesColors'>,
  species: { readonly canonicalName: string; readonly stratum: string | null },
): SpeciesAppearance {
  return {
    symbol: resolvePlantSymbolForPlant({ canonicalName: species.canonicalName }, scene.plantSpeciesSymbols),
    color: resolvePlantBaseColor({
      kind: 'plant',
      id: '',
      canonicalName: species.canonicalName,
      commonName: null,
      color: scene.plantSpeciesColors[species.canonicalName] ?? null,
      stratum: species.stratum,
      canopySpreadM: null,
      position: { x: 0, y: 0 },
      rotationDeg: null,
      notes: null,
      plantedDate: null,
      quantity: 1,
      locked: false,
    }, EMPTY_SPECIES_CACHE),
  }
}

/** Codes belong to a Design; removed species keep their reservation. */
export function allocateSpeciesCodes(
  existing: Readonly<Record<string, string>>,
  canonicalNames: Iterable<string>,
): Record<string, string> {
  const codes: Record<string, string> = Object.create(null)
  const used = new Set<string>()
  const names = [
    ...new Set([...Object.keys(existing), ...canonicalNames]),
  ].sort()
  for (const name of names) {
    const code = existing[name]
    if (
      typeof code === 'string' &&
      /^[A-Z]{1,6}[0-9]{0,6}$/.test(code) &&
      !used.has(code)
    ) {
      codes[name] = code
      used.add(code)
    }
  }
  for (const name of names) {
    if (codes[name]) continue
    const words =
      name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .match(/[A-Z]+/g) ?? []
    const base =
      words.length > 1
        ? words[0]![0]! + words[1]!.slice(0, 2)
        : words[0]?.slice(0, 3) || 'SP'
    let code = base
    let suffix = 2
    while (used.has(code)) code = `${base}${suffix++}`
    codes[name] = code
    used.add(code)
  }
  return codes
}

export interface SpeciesFocus {
  readonly canonicalName: string | null
  readonly showCodes: boolean
}

export interface SpeciesFocusCommands {
  focus(canonicalName: string | null): void
  showCodes(visible: boolean): void
}

export function speciesFocusOpacity(
  focus: SpeciesFocus,
  canonicalName: string,
): number {
  return focus.canonicalName && focus.canonicalName !== canonicalName ? 0.16 : 1
}

const NO_ENGLISH_FALLBACKS: ReadonlyMap<string, string> = new Map()

/**
 * The species names lists show: the name in the UI language, else the English
 * catalog name (see `CanvasQuerySurface.getEnglishFallbackNames`).
 */
export function speciesDisplayNames(
  localizedNames: ReadonlyMap<string, string | null>,
  englishFallbackNames: ReadonlyMap<string, string>,
): ReadonlyMap<string, string | null> {
  if (englishFallbackNames.size === 0) return localizedNames
  const names = new Map(localizedNames)
  for (const [canonicalName, englishName] of englishFallbackNames) {
    if (!names.get(canonicalName)) names.set(canonicalName, englishName)
  }
  return names
}

/** Whether `shownName` is the English fallback name resolved for the species. */
export function isEnglishFallbackName(
  englishFallbackNames: ReadonlyMap<string, string>,
  canonicalName: string,
  shownName: string | null | undefined,
): boolean {
  return Boolean(shownName) && englishFallbackNames.get(canonicalName) === shownName
}

export interface SpeciesKeyEntry {
  readonly canonicalName: string
  readonly commonName: string | null
  /** The common name is the English catalog name: none exists in the UI language. */
  readonly englishFallback: boolean
  readonly code: string
  readonly count: number
  readonly appearances: readonly { symbol: PlantSymbolId; color: string }[]
}

export function buildSpeciesKey(
  scene: ScenePersistedState,
  localizedNames: ReadonlyMap<string, string | null>,
  englishFallbackNames: ReadonlyMap<string, string> = NO_ENGLISH_FALLBACKS,
): SpeciesKeyEntry[] {
  const entries = new Map<
    string,
    {
      canonicalName: string
      commonName: string | null
      englishFallback: boolean
      code: string
      count: number
      appearances: { symbol: PlantSymbolId; color: string }[]
    }
  >()
  for (const plant of scene.plants) {
    let entry = entries.get(plant.canonicalName)
    if (!entry) {
      entry = {
        canonicalName: plant.canonicalName,
        commonName: localizedNames.get(plant.canonicalName)
          || englishFallbackNames.get(plant.canonicalName)
          || plant.commonName,
        englishFallback: !localizedNames.get(plant.canonicalName)
          && Boolean(englishFallbackNames.get(plant.canonicalName)),
        code: scene.plantSpeciesCodes[plant.canonicalName] ?? '',
        count: 0,
        appearances: [],
      }
      entries.set(plant.canonicalName, entry)
    }
    entry.count += 1
    const symbol = resolvePlantSymbolForPlant(plant, scene.plantSpeciesSymbols)
    const color = resolvePlantBaseColor(plant, EMPTY_SPECIES_CACHE)
    if (
      !entry.appearances.some(
        (appearance) =>
          appearance.symbol === symbol && appearance.color === color,
      )
    )
      entry.appearances.push({ symbol, color })
  }
  return [...entries.values()].sort((a, b) =>
    a.canonicalName < b.canonicalName
      ? -1
      : a.canonicalName > b.canonicalName
        ? 1
        : 0,
  )
}
