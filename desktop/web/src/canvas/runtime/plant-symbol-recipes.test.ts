import { describe, expect, it } from 'vitest'
import { PLANT_SYMBOL_IDS } from './scene/plant-symbols'
import {
  buildPlantSymbolRecipes,
  getPlantSymbolArt,
  PLANT_SYMBOL_FAMILIES,
  PLANT_SYMBOL_RECIPES,
  plantSymbolPath,
  tracePlantSymbolContour,
  type PlantSymbolContour,
} from './plant-symbol-recipes'

function signedArea(contour: PlantSymbolContour): number {
  const points = contour.flatMap((command) => command[0] === 'C'
    ? [[command[1], command[2]], [command[3], command[4]], [command[5], command[6]]]
    : [[command[1], command[2]]])
  return points.reduce((sum, [x0, y0], i) => {
    const [x1, y1] = points[(i + 1) % points.length]!
    return sum + x0! * y1! - x1! * y0!
  }, 0)
}

describe('plant symbol recipes', () => {
  it('draws every symbol id at compact and detailed sizes with finite, closed contours inside the footprint', () => {
    expect(Object.keys(PLANT_SYMBOL_RECIPES)).toEqual([...PLANT_SYMBOL_IDS])
    for (const symbol of PLANT_SYMBOL_IDS) {
      const recipe = PLANT_SYMBOL_RECIPES[symbol]
      for (const art of [recipe.compact, recipe.detailed]) {
        expect(art.body.length, symbol).toBeGreaterThan(0)
        for (const contour of [...art.body, ...art.cutouts]) {
          expect(contour[0]?.[0]).toBe('M')
          expect(contour.length).toBeGreaterThan(2)
          for (const command of contour) for (const value of command.slice(1)) {
            expect(Number.isFinite(value)).toBe(true)
            expect(Math.abs(Number(value)), symbol).toBeLessThanOrEqual(1)
          }
        }
      }
      expect(getPlantSymbolArt(symbol, 12)).toBe(recipe.compact)
      expect(getPlantSymbolArt(symbol, 16)).toBe(recipe.detailed)
    }
  })

  it('is deterministic: rebuilding the artwork yields identical contours', () => {
    expect(buildPlantSymbolRecipes()).toEqual(PLANT_SYMBOL_RECIPES)
    expect(JSON.stringify(buildPlantSymbolRecipes())).toBe(JSON.stringify(PLANT_SYMBOL_RECIPES))
  })

  it('winds every contour the same way so one nonzero fill is the union of the parts', () => {
    for (const symbol of PLANT_SYMBOL_IDS) {
      const { body, cutouts } = PLANT_SYMBOL_RECIPES[symbol].detailed
      for (const contour of [...body, ...cutouts]) expect(signedArea(contour), symbol).toBeGreaterThan(0)
    }
  })

  it('keeps compact cutouts a subset of the detailed ones and drops only sub-pixel detail', () => {
    for (const symbol of PLANT_SYMBOL_IDS) {
      const { compact, detailed } = PLANT_SYMBOL_RECIPES[symbol]
      expect(detailed.body).toBe(compact.body)
      expect(detailed.cutouts.slice(0, compact.cutouts.length)).toEqual(compact.cutouts)
    }
    expect(getPlantSymbolArt('bamboo', 15.99).cutouts).toHaveLength(0)
    expect(getPlantSymbolArt('bamboo', 16).cutouts).toHaveLength(7)
    expect(getPlantSymbolArt('flower', 8).cutouts).toHaveLength(1)
    expect(getPlantSymbolArt('pod', 8).cutouts).toHaveLength(3)
    expect(getPlantSymbolArt('bee', 8).cutouts).toHaveLength(2)
  })

  it('groups the 29 designed symbols in three families plus the abstract marks', () => {
    expect(PLANT_SYMBOL_FAMILIES.form).toHaveLength(12)
    expect(PLANT_SYMBOL_FAMILIES.gives).toEqual(['apple', 'nut', 'berry', 'grape', 'flower', 'pod'])
    expect(PLANT_SYMBOL_FAMILIES.does).toHaveLength(11)
    expect(Object.values(PLANT_SYMBOL_FAMILIES).flat()).toEqual([...PLANT_SYMBOL_IDS])
  })

  it('writes one closed subpath per contour', () => {
    const art = getPlantSymbolArt('canopy', 24)
    const d = plantSymbolPath(art.body)
    expect(d.match(/M /g)).toHaveLength(art.body.length)
    expect(d.match(/ Z/g)).toHaveLength(art.body.length)
  })

  it('traces native cubic geometry at the requested center and radius', () => {
    const commands: unknown[][] = []
    const target = {
      moveTo: (...args: number[]) => commands.push(['M', ...args]),
      lineTo: (...args: number[]) => commands.push(['L', ...args]),
      bezierCurveTo: (...args: number[]) => commands.push(['C', ...args]),
      closePath: () => commands.push(['Z']),
    }
    tracePlantSymbolContour(target, [['M', -1, 0], ['C', -1, -1, 1, -1, 1, 0], ['L', 0, 1]], 10, 20, 5)
    expect(commands).toEqual([['M', 5, 20], ['C', 5, 15, 15, 15, 15, 20], ['L', 10, 25], ['Z']])
  })
})
