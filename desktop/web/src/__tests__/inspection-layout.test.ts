import { expect, it } from 'vitest'
import { inspectionLayout, inspectionScale } from '../canvas/runtime/inspection-layout'
import { createTestRendererView, createTestSceneRendererSnapshot } from './support/scene-renderer-snapshot'

/** The lens's view at bearing 0: the plane origin at the centre of a frame, at the layout's scale. */
function lensViewAt(plants: Parameters<typeof inspectionScale>[0], frame: { width: number; height: number }) {
  const scale = inspectionScale(plants, { x: 0, y: 0 }, 1)
  expect(Number.isFinite(scale)).toBe(true)
  return createTestRendererView({ x: frame.width / 2, y: frame.height / 2, scale }, { screen: { ...frame, devicePixelRatio: 1 } })
}

it('keeps full localized and fallback names for coincident plants, wrapping long names within the frame', () => {
  const plants = createTestSceneRendererSnapshot({ scene: { plants: ['a', 'b', 'c'].map((id, i) => ({
    kind: 'plant', id, canonicalName: `Species ${id}`, commonName: i === 1 ? 'Stored common name' : null,
    position: { x: 0, y: 0 }, color: null, stratum: null, canopySpreadM: null, rotationDeg: null,
    scale: null, notes: null, plantedDate: null, quantity: null, locked: false,
  })) } }).scene.plants
  const local = 'E\u0301rable à longues feuilles 稲 稲 稲 et une description botanique particulièrement longue'
  const laidOut = inspectionLayout(plants, lensViewAt(plants, { width: 430, height: 390 }), new Map([['Species a', local]]), value => Array.from(value).length * 8)
  expect(laidOut.map(plant => plant.name)).toEqual([local, 'Stored common name', 'Species c'])
  expect(laidOut[0]!.label!.lines.length).toBeGreaterThan(1)
  for (const plant of laidOut) {
    expect(plant.label!.lines.join('')).toBe(plant.name.normalize('NFC'))
    expect(plant.screenPosition.x).toBeCloseTo(215, 9)
    expect(plant.screenPosition.y).toBeCloseTo(195, 9)
    expect(plant.label!.x + plant.label!.width).toBeLessThanOrEqual(430)
    expect(plant.label!.y + plant.label!.height).toBeLessThanOrEqual(390)
  }
  const edgePlants = plants.slice(0, 2).map((plant, i) => ({ ...plant, commonName: i ? 'Consoude officinale' : 'Menthe verte',
    position: i ? { x: -.2, y: .1 } : { x: 0, y: 0 } }))
  const edge = inspectionLayout(edgePlants, lensViewAt(edgePlants, { width: 180, height: 220 }), new Map(), value => value.length * 8)
  expect(edge.every(plant => plant.label !== null)).toBe(true)
})
