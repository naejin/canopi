import {
  resolvePlantSymbolForPlant,
  type PlantSymbolId,
  type ScenePersistedState,
} from './scene'
import { resolvePlantBaseColor } from './plant-presentation'
import type { SpeciesCacheEntry } from './species-cache'

const EMPTY_SPECIES_CACHE = new Map<string, SpeciesCacheEntry>()

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

export interface SpeciesKeyEntry {
  readonly canonicalName: string
  readonly commonName: string | null
  readonly code: string
  readonly count: number
  readonly appearances: readonly { symbol: PlantSymbolId; color: string }[]
}

export function buildSpeciesKey(
  scene: ScenePersistedState,
  localizedNames: ReadonlyMap<string, string | null>,
): SpeciesKeyEntry[] {
  const entries = new Map<
    string,
    {
      canonicalName: string
      commonName: string | null
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
        commonName: localizedNames.get(plant.canonicalName) || plant.commonName,
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
