import { createDefaultScenePersistedState } from '../../src/canvas/runtime/scene'
import { buildCanvasPrintSnapshot } from '../../src/canvas/runtime/print-snapshot'
import type { PdfPreparation } from '../../src/app/canvas-pdf/prepare'
import type { PdfSetup } from '../../src/app/canvas-pdf/types'

export const fixtureNames = ['dense', 'mixed', 'legends', 'multilingual', 'map-excluded', 'stress-1', 'stress-10', 'stress-50'] as const
export type FixtureName = typeof fixtureNames[number]
const species = [
  ['Malus domestica', 'Apple', 'tree', '#496e36'], ['Pyrus communis', 'Pear', 'tree', '#627f39'],
  ['Corylus avellana', 'Hazel', 'shrub', '#946936'], ['Ribes nigrum', 'Blackcurrant', 'shrub', '#713e64'],
  ['Fragaria vesca', 'Wild strawberry', 'groundcover', '#985344'], ['Thymus vulgaris', 'Thyme', 'herbaceous', '#568479'],
  ['Salvia rosmarinus', 'Rosemary', 'herbaceous', '#496e36'], ['Allium schoenoprasum', 'Chives', 'herbaceous', '#784f91'],
  ['Vitis vinifera', 'Grape vine', 'climber', '#627f39'], ['Melissa officinalis', 'Lemon balm', 'herbaceous', '#986b24'],
  ['Lavandula angustifolia', 'Lavender', 'shrub', '#713e64'], ['Symphytum officinale', 'Comfrey', 'groundcover', '#568479'],
] as const
export function fixture(name: FixtureName): Omit<PdfPreparation, 'fontBaseUrl'> {
  const scene = createDefaultScenePersistedState()
  let setup: PdfSetup = { paper: 'A4', layers: ['plants', 'zones', 'annotations', 'measurement-guides'], continuations: true }
  const count = name === 'dense' ? 320 : name === 'legends' ? 100 : name.startsWith('stress') ? (name === 'stress-50' ? 10_000 : name === 'stress-10' ? 900 : 100) : 120
  const commonNames: Record<string, string> = {}
  const side = name === 'dense' ? 16 : Math.ceil(Math.sqrt(count))
  const spacing = name === 'dense' ? .12 : name.startsWith('stress') ? 10 : 1.5
  for (let i = 0; i < count; i++) {
    const [canonical, local, symbol, color] = species[i % species.length]!
    const canonicalName = name === 'legends' ? `${canonical} cultivar ${String(i).padStart(3, '0')}` : canonical
    if (name !== 'legends') commonNames[canonicalName] = local
    scene.plantSpeciesSymbols[canonicalName] = symbol
    scene.plants.push({ kind: 'plant', id: `p${i}`, canonicalName, commonName: null, position: { x: i % side * spacing, y: Math.floor(i / side) * spacing },
      color, pinnedName: i < 2 && name !== 'dense', locked: false, stratum: null, canopySpreadM: null, rotationDeg: 0, scale: null, notes: null, plantedDate: null, quantity: 1 })
  }
  if (name === 'dense') setup = { ...setup, areas: [{ kind: 'rectangle', id: 'bed', name: 'Nursery bed', bounds: { x: -.2, y: -.2, width: 2.2, height: 2.8 } }] }
  if (name === 'mixed' || name === 'map-excluded') {
    scene.zones.push({ kind: 'zone', name: 'Orchard', locked: false, zoneType: 'rect', rotationDeg: 0, fillColor: null, notes: null,
      points: [{ x: -1, y: -1 }, { x: 29, y: -1 }, { x: 29, y: 19 }, { x: -1, y: 19 }] })
    scene.zones.push({ kind: 'zone', name: 'Access path', locked: false, zoneType: 'line', rotationDeg: 0, fillColor: null, notes: null,
      points: [{ x: -3, y: -3 }, { x: 28, y: -3 }, { x: 28, y: 18 }] })
    setup = { ...setup, areas: [{ kind: 'zone', name: 'Orchard' }] }
  }
  if (name === 'stress-10' || name === 'stress-50') {
    const areas = name === 'stress-10' ? 9 : 49, columns = name === 'stress-10' ? 3 : 7
    setup = { ...setup, views: { overview: { orientation: 'portrait' } }, areas: Array.from({ length: areas }, (_, i) => ({ kind: 'rectangle', id: String(i),
      name: `Plot ${i + 1}`, bounds: { x: i % columns * 150, y: Math.floor(i / columns) * 150, width: 100, height: 150 } })) }
  }
  if (name === 'multilingual') {
    Object.assign(commonNames, { 'Malus domestica': 'Яблоня', 'Pyrus communis': '梨', 'Thymus vulgaris': 'タイム', 'Vitis vinifera': '포도',
      'Salvia rosmarinus': 'Romarin à feuilles longues', 'Corylus avellana': 'Noisetier' })
    scene.annotations.push({ kind: 'annotation', id: 'note', annotationType: 'text', position: { x: 0, y: -3 }, text: 'Érable Яблоня 庭園 ローズマリー 정원', fontSize: 16, rotationDeg: 0, locked: false })
  }
  // Map state is deliberately absent from the public print projection. Extra
  // basemap layers exercise filtering without any provider or map capture.
  if (name === 'map-excluded') scene.layers.push({ kind: 'layer', name: 'satellite', visible: true, locked: false, opacity: 1 })
  return { input: { name: name === 'map-excluded' ? 'mixed' : name, locale: 'en', commonNames,
    canvas: buildCanvasPrintSnapshot(scene, { viewport: { x: 99, y: -99, scale: .001 }, speciesCache: new Map() }) }, setup,
    labels: { overview: 'Overview', plants: 'Plants on this page', actualSize: 'Print at actual size', page: 'Page', continued: 'Continued', legendFor: 'Plant list for page' } }
}
