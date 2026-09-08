import { createDefaultScenePersistedState, type ScenePersistedState } from '../../canvas/runtime/scene'

export type ZoomCalibrationScene = 'garden' | 'dense' | 'site'

/** Deterministic, synthetic Designs shared by visual calibration and regression coverage. */
export function createZoomCalibrationScene(name: ZoomCalibrationScene): ScenePersistedState {
  const scene = createDefaultScenePersistedState()
  const columns = name === 'garden' ? 6 : name === 'dense' ? 12 : 40
  const rows = name === 'garden' ? 6 : name === 'dense' ? 10 : 32
  const spacing = name === 'dense' ? 1.5 : name === 'garden' ? 4 : 5
  const names = ['Apple', 'Blackcurrant', 'Common comfrey', 'Elaeagnus × ebbingei', 'Cerisier de Sainte-Lucie', 'ローズマリー']
  const symbols = ['tree', 'shrub', 'herbaceous', 'climber', 'groundcover', 'round']
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column
      scene.plants.push({
        kind: 'plant', id: `plant-${index}`, locked: index === 2,
        canonicalName: `Species ${index}`, commonName: names[index % names.length]!,
        color: null, symbol: symbols[index % symbols.length], pinnedName: index % 3 !== 0,
        stratum: 'medium', canopySpreadM: null,
        position: { x: 5 + column * spacing, y: 7 + row * spacing },
        rotationDeg: null, scale: null, notes: null, plantedDate: null, quantity: null,
      })
    }
  }
  const width = columns * spacing + 8
  const height = rows * spacing + 10
  scene.zones = [{
    kind: 'zone', name: 'Planting bed', locked: false, zoneType: 'rect',
    points: [{ x: 2, y: 3 }, { x: width, y: 3 }, { x: width, y: height }, { x: 2, y: height }],
    rotationDeg: 0, fillColor: null, notes: null,
  }]
  scene.annotations = [
    { kind: 'annotation', id: 'note-0', locked: false, annotationType: 'text', position: { x: 2, y: 0 }, text: 'Food forest · North bed', fontSize: 16, rotationDeg: 0 },
    { kind: 'annotation', id: 'note-1', locked: false, annotationType: 'text', position: { x: width / 2, y: height / 2 }, text: 'Keep access clear\nMulch after planting', fontSize: 14, rotationDeg: -20 },
    { kind: 'annotation', id: 'note-2', locked: true, annotationType: 'text', position: { x: 2, y: height + 4 }, text: 'Zone humide — conserver les plantes spontanées', fontSize: 14, rotationDeg: 0 },
  ]
  scene.measurementGuides = [{ kind: 'measurement-guide', id: 'distance', locked: false, start: { x: 2, y: height + 2 }, end: { x: width, y: height + 2 } }]
  scene.groups = [{ kind: 'group', id: 'guild', name: 'Guild', locked: false, members: [{ kind: 'plant', id: 'plant-0' }, { kind: 'plant', id: 'plant-1' }] }]
  return scene
}
