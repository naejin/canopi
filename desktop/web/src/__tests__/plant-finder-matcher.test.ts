import { describe, expect, it } from 'vitest'
import {
  findPlants,
  plantFinderRangesIn,
  type PlantFinderRecord,
} from '../app/plant-finder/matcher'

const records: PlantFinderRecord<string>[] = [
  species('Malus domestica', 'MDO', ['Pommier cultivé', 'Apple'], ['Pyrus malus']),
  species('Malus sylvestris', 'MSY', ['Pommier sauvage', 'Crab apple']),
  species('Mentha spicata', 'MSP', ['Menthe verte', 'Spearmint']),
  species('Acer campestre', 'ACA', ['Érable champêtre', 'Field maple']),
  species('Prunus domestica', 'PDO', ['Prunier commun', 'Plum']),
  species('Symphytum officinale', 'SOF2', ['Consoude officinale', 'Comfrey']),
  species('Pyrus communis', 'PCO', ['Poirier', 'Pear']),
]

function species(
  scientific: string,
  code: string,
  common: readonly string[],
  synonyms: readonly string[] = [],
): PlantFinderRecord<string> {
  return {
    key: scientific,
    names: [
      ...common.map((text) => ({ text, kind: 'common' as const })),
      { text: scientific, kind: 'scientific' as const },
      ...synonyms.map((text) => ({ text, kind: 'synonym' as const })),
      { text: code, kind: 'code' as const },
    ],
  }
}

function keys(query: string): string[] {
  return findPlants(records, query).hits.map((hit) => hit.key)
}

describe('plant finder matcher', () => {
  it('is inactive without searchable text', () => {
    const result = findPlants(records, '  · ')
    expect(result.active).toBe(false)
    expect(result.hits).toEqual([])
  })

  it('matches common names in any language, ignoring case and accents', () => {
    expect(keys('ERABLE')).toEqual(['Acer campestre'])
    expect(keys('champetre')).toEqual(['Acer campestre'])
    expect(keys('field maple')).toEqual(['Acer campestre'])
    expect(keys('spearmint')).toEqual(['Mentha spicata'])
  })

  it('matches scientific names, synonyms and codes', () => {
    expect(keys('sylvestris')).toEqual(['Malus sylvestris'])
    expect(keys('pyrus malus')).toEqual(['Malus domestica'])
    expect(keys('msp')).toEqual(['Mentha spicata'])
    expect(keys('SOF2')).toEqual(['Symphytum officinale'])
  })

  it('ranks an exact code and whole names above partial matches', () => {
    expect(keys('pdo')[0]).toBe('Prunus domestica')
    expect(keys('poirier')).toEqual(['Pyrus communis'])
    // A whole-word match beats a word start, which beats a match inside a word.
    const ranked = keys('pom')
    expect(ranked).toEqual(['Malus domestica', 'Malus sylvestris'])
    expect(keys('domestica')).toEqual(['Malus domestica', 'Prunus domestica'])
  })

  it('needs every query word to match', () => {
    expect(keys('pommier sauvage')).toEqual(['Malus sylvestris'])
    expect(keys('malus dom')).toEqual(['Malus domestica'])
    expect(keys('pommier plum')).toEqual([])
  })

  it('tolerates small typos and says what it searched instead', () => {
    const result = findPlants(records, 'pomier')
    expect(result.hits.map((hit) => hit.key)).toEqual(['Malus domestica', 'Malus sylvestris'])
    expect(result.hits.every((hit) => hit.typo)).toBe(true)
    expect(result.correction).toBe('pommier')
    expect(findPlants(records, 'mentah').correction).toBe('mentha')
    expect(keys('consoud')).toEqual(['Symphytum officinale'])
  })

  it('prefers exact matches over typo matches and never corrects short words', () => {
    const exact = findPlants(records, 'pear')
    // "Spearmint" contains the word too, below the whole-name match.
    expect(exact.hits.map((hit) => hit.key)).toEqual(['Pyrus communis', 'Mentha spicata'])
    expect(exact.correction).toBeNull()
    expect(keys('mdx')).toEqual([])
    expect(findPlants(records, 'zzzzzz').hits).toEqual([])
  })

  it('returns ranges of the original text for highlighting', () => {
    const result = findPlants(records, 'erable')
    const hit = result.byKey.get('Acer campestre')
    expect(plantFinderRangesIn(hit, 'Érable champêtre')).toEqual([{ start: 0, end: 6 }])
    const typo = findPlants(records, 'pomier').byKey.get('Malus sylvestris')
    expect(plantFinderRangesIn(typo, 'Pommier sauvage')).toEqual([{ start: 0, end: 7 }])
    const multi = findPlants(records, 'sauv pomm').byKey.get('Malus sylvestris')
    expect(plantFinderRangesIn(multi, 'Pommier sauvage')).toEqual([{ start: 0, end: 4 }, { start: 8, end: 12 }])
    expect(plantFinderRangesIn(hit, 'Field maple')).toEqual([])
  })

  it('folds ß and matches inside words for longer queries and CJK', () => {
    const extra: PlantFinderRecord<string>[] = [
      { key: 'a', names: [{ text: 'Weißdorn', kind: 'common' }] },
      { key: 'b', names: [{ text: '苹果', kind: 'common' }] },
    ]
    expect(findPlants(extra, 'weissdorn').hits.map((hit) => hit.key)).toEqual(['a'])
    expect(findPlants(extra, 'dorn').hits.map((hit) => hit.key)).toEqual(['a'])
    expect(findPlants(extra, '果').hits.map((hit) => hit.key)).toEqual(['b'])
  })
})
