import { expect, it } from 'vitest'
import { inspectionLayout } from '../canvas/runtime/inspection-layout'
import { createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'

it('keeps full localized and fallback names for coincident plants, wrapping long names within the frame', () => {
  const plants = createTestSceneRendererSnapshot({ scene: { plants: ['a', 'b', 'c'].map((id, i) => ({
    kind: 'plant', id, canonicalName: `Species ${id}`, commonName: i === 1 ? 'Stored common name' : null,
    position: { x: 0, y: 0 }, color: null, stratum: null, canopySpreadM: null, rotationDeg: null,
    scale: null, notes: null, plantedDate: null, quantity: null, locked: false,
  })) } }).scene.plants
  const local = 'E\u0301rable à longues feuilles 稲 稲 稲 et une description botanique particulièrement longue'
  const layout = inspectionLayout(plants, { x: 0, y: 0 }, { width: 430, height: 390 }, new Map([['Species a', local]]), value => Array.from(value).length * 8)
  expect(Number.isFinite(layout.scale)).toBe(true)
  expect(layout.plants.map(plant => plant.name)).toEqual([local, 'Stored common name', 'Species c'])
  expect(layout.plants[0]!.label!.lines.length).toBeGreaterThan(1)
  for (const plant of layout.plants) {
    expect(plant.label!.lines.join('')).toBe(plant.name.normalize('NFC'))
    expect(plant.screenPosition).toEqual({ x: 215, y: 195 })
    expect(plant.label!.x + plant.label!.width).toBeLessThanOrEqual(430)
    expect(plant.label!.y + plant.label!.height).toBeLessThanOrEqual(390)
  }
  const edge = inspectionLayout(plants.slice(0, 2).map((plant, i) => ({ ...plant, commonName: i ? 'Consoude officinale' : 'Menthe verte',
    position: i ? { x: -.2, y: .1 } : { x: 0, y: 0 } })), { x: 0, y: 0 }, { width: 180, height: 220 }, new Map(), value => value.length * 8)
  expect(edge.plants.every(plant => plant.label !== null)).toBe(true)
})
