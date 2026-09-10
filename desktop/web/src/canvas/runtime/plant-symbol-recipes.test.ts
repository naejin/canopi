import { describe, expect, it } from 'vitest'
import { PLANT_SYMBOL_IDS } from './scene/plant-symbols'
import { getPlantSymbolShapes, PLANT_SYMBOL_RECIPES, plantSymbolShapePath, tracePlantSymbolContour } from './plant-symbol-recipes'

describe('botanical symbol geometry', () => {
  it('covers the catalog with finite, closed contours inside the unchanged footprint', () => {
    expect(Object.keys(PLANT_SYMBOL_RECIPES)).toEqual([...PLANT_SYMBOL_IDS])
    for (const symbol of PLANT_SYMBOL_IDS) for (const size of [8, 12, 16, 32]) {
      const shapes = getPlantSymbolShapes(symbol, size)
      expect(shapes.length).toBeGreaterThan(0)
      for (const shape of shapes) for (const contour of [shape.outline, ...(shape.holes ?? [])]) {
        expect(contour[0]?.[0]).toBe('M')
        expect(contour.length).toBeGreaterThan(2)
        for (const command of contour) for (const value of command.slice(1)) {
          expect(Number.isFinite(value)).toBe(true)
          expect(Math.abs(Number(value))).toBeLessThanOrEqual(1.03)
        }
        expect(plantSymbolShapePath(shape)).toMatch(/ Z$/)
      }
    }
  })

  it('keeps small bamboo canes continuous and reveals joints only at the detail threshold', () => {
    expect(getPlantSymbolShapes('bamboo', 15.99)).toHaveLength(4)
    expect(getPlantSymbolShapes('bamboo', 16)).toHaveLength(8)
    expect(getPlantSymbolShapes('canopy', 12)[0]?.holes).toBeUndefined()
    expect(getPlantSymbolShapes('canopy', 16)[0]?.holes).toHaveLength(1)
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
