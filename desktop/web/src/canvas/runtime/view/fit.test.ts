import { describe, expect, it } from 'vitest'
import { sceneExtentPoints } from '../scene-extent'
import type { SceneAnnotationEntity, ScenePersistedState } from '../scene'
import { fitScene, fitTemporaryBounds, framingRect, type FitFrame } from './fit'
import type { PlanarCamera, SceneBounds, ScreenInsets, WorldPoint } from './types'

function note(id: string, x: number, y: number, text: string, rotationDeg: number | null): SceneAnnotationEntity {
  return { kind: 'annotation', id, annotationType: 'text', locked: false, position: { x, y }, text, fontSize: 16, rotationDeg }
}

function scene(): ScenePersistedState {
  return {
    plantSpeciesColors: {},
    plantSpeciesSymbols: {},
    plantSpeciesCodes: {},
    layers: [],
    plants: [
      {
        kind: 'plant', locked: false, id: 'apple', canonicalName: 'Malus domestica', commonName: 'Apple', color: null,
        stratum: null, canopySpreadM: null, position: { x: 10, y: 20 }, rotationDeg: null, notes: null, plantedDate: null, quantity: null,
      },
      {
        kind: 'plant', locked: false, id: 'walnut', canonicalName: 'Juglans regia', commonName: 'Walnut', color: null,
        stratum: null, canopySpreadM: 12, position: { x: -35, y: 62 }, rotationDeg: null, notes: null, plantedDate: null, quantity: null,
      },
    ],
    zones: [
      {
        kind: 'zone', locked: false, id: 'bed', name: null, zoneType: 'rect',
        points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }, { x: 0, y: 40 }],
        rotationDeg: 0, fillColor: null, notes: null,
      },
      {
        kind: 'zone', locked: false, id: 'pond', name: 'pond', zoneType: 'ellipse',
        points: [{ x: 80, y: -10 }, { x: 14, y: 6 }], rotationDeg: 30, fillColor: null, notes: null,
      },
    ],
    annotations: [note('label', 50, 60, 'A long note\nWith another line', 45), note('sign', -20, -15, 'Gate', null)],
    measurementGuides: [],
    groups: [],
    guides: [],
  }
}

/** The scene's extent (scene-extent.ts), counting the scales it is measured at. */
function countedExtent(design: ScenePersistedState, calls: { count: number }) {
  const extent = sceneExtentPoints(design)
  return (pixelsPerMetre: number): readonly WorldPoint[] => {
    calls.count += 1
    return extent(pixelsPerMetre)
  }
}

type Placement = readonly [x: number, y: number, scale: number]

/** Today's CameraController scale bounds (the default policy's), recorded at 52cbff10. */
const TODAY_SCALE_BOUNDS = { min: 1.2790334061860095e-05, max: 1716.6895781438734 }

/** The fit frame of today's CameraController placed at `placement` on a screen. */
function fitFrame(width: number, height: number, placement: Placement, insets?: ScreenInsets): FitFrame {
  const [x, y, scale] = placement
  return { screen: { width, height }, insets, scaleBounds: TODAY_SCALE_BOUNDS, current: { x, y, scale, bearingDeg: 0 } }
}

/** Checks a fit's placement against a tolerant golden literal (precision 6: close, not bit for bit). */
function expectPlacement(actual: PlanarCamera | null, expected: Placement | null, precision = 6): void {
  if (!expected) {
    expect(actual).toBeNull()
    return
  }
  expect(actual).not.toBeNull()
  const [x, y, scale] = expected
  expect(actual!.x).toBeCloseTo(x, precision)
  expect(actual!.y).toBeCloseTo(y, precision)
  expect(actual!.scale).toBeCloseTo(scale, precision)
  expect(actual!.bearingDeg).toBe(0)
}

/** A world-axis box around points, as computeSceneBounds returned it. */
function worldAxisBox(points: readonly WorldPoint[]): SceneBounds | null {
  if (points.length === 0) return null
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  }
}

function orientedSpan(points: readonly WorldPoint[], bearingDeg: number): { width: number; height: number } {
  const radians = bearingDeg * Math.PI / 180
  const across = points.map(({ x, y }) => x * Math.cos(radians) + y * Math.sin(radians))
  const down = points.map(({ x, y }) => -x * Math.sin(radians) + y * Math.cos(radians))
  return { width: Math.max(...across) - Math.min(...across), height: Math.max(...down) - Math.min(...down) }
}

function screenOf(camera: PlanarCamera, point: WorldPoint): WorldPoint {
  const radians = camera.bearingDeg * Math.PI / 180
  return {
    x: (point.x * Math.cos(radians) + point.y * Math.sin(radians)) * camera.scale + camera.x,
    y: (-point.x * Math.sin(radians) + point.y * Math.cos(radians)) * camera.scale + camera.y,
  }
}

describe('fit', () => {
  it('at bearing 0 the fit matches today\'s fitCameraViewport for plants, zones and notes', () => {
    // Today's fitCameraViewport (canvas/runtime/camera.ts:520-565 at 52cbff10) on a 1000 × 800 CameraController placed at
    // { x: 3, y: -7, scale }, recorded for each design, each insets case and each starting scale (0.05, 1, 14, 1000).
    const insetCases: Array<ScreenInsets | undefined> = [
      undefined,
      { top: 40, right: 300, bottom: 20, left: 60 },
      { top: 400, right: 0, bottom: 390, left: 0 }, // leaves under 120 px: the whole screen frames
    ]
    const today: Record<string, readonly (readonly Placement[])[]> = {
      'all': [
        [ // no insets
          [321.86648248855136, 199.13374905945437, 6.250768110439437],
          [321.8664709782407, 199.1342536429958, 6.250768234888686],
          [321.8664415146735, 199.13554525008448, 6.250768553448191],
          [321.8664317945567, 199.13597135414284, 6.2507686585419],
        ],
        [ // chrome
          [266.5616924815175, 255.70978937427267, 3.9943596443801033],
          [266.56168933055824, 255.70993595044615, 3.994359678448213],
          [266.5616682223009, 255.71091786259205, 3.9943599066702724],
          [266.56165476343983, 255.71154394007777, 3.99436005218721],
        ],
        [ // too little
          [321.86648248855136, 199.13374905945437, 6.250768110439437],
          [321.8664709782407, 199.1342536429958, 6.250768234888686],
          [321.8664415146735, 199.13554525008448, 6.250768553448191],
          [321.8664317945567, 199.13597135414284, 6.2507686585419],
        ],
      ],
      'no plants': [
        [ // no insets
          [271.47728966793363, 198.0146817718866, 6.304944763472309],
          [271.476958405845, 198.01485284368036, 6.304953902997952],
          [271.47188231986644, 198.017474257852, 6.305093952280857],
          [271.47188231986644, 198.017474257852, 6.305093952280857],
        ],
        [ // chrome
          [215.03031704518497, 244.20965236488703, 4.551515852259248],
          [215.03031704518497, 244.20965236488703, 4.551515852259248],
          [215.03031704518497, 244.20965236488703, 4.551515852259248],
          [215.03031704518497, 244.20965236488703, 4.551515852259248],
        ],
        [ // too little
          [271.47728966793363, 198.0146817718866, 6.304944763472309],
          [271.476958405845, 198.01485284368036, 6.304953902997952],
          [271.47188231986644, 198.017474257852, 6.305093952280857],
          [271.47188231986644, 198.017474257852, 6.305093952280857],
        ],
      ],
      'notes only': [
        [ // no insets
          [343.03594653398034, 179.26222820168357, 6.617481880112239],
          [343.0360919207757, 179.26237245264457, 6.617491496842971],
          [343.0384228560109, 179.26468517744837, 6.617645678496559],
          [343.03976333604425, 179.2660151849813, 6.617734345665422],
        ],
        [ // chrome
          [237.31291361701997, 210.67782562578083, 5.665645680850998],
          [237.31351043413198, 210.67845462420772, 5.665675521706599],
          [237.3163285609853, 210.6814247088816, 5.665816428049265],
          [237.3150856468813, 210.68011477489944, 5.665754282344065],
        ],
        [ // too little
          [343.03594653398034, 179.26222820168357, 6.617481880112239],
          [343.0360919207757, 179.26237245264457, 6.617491496842971],
          [343.0384228560109, 179.26468517744837, 6.617645678496559],
          [343.03976333604425, 179.2660151849813, 6.617734345665422],
        ],
      ],
      'no notes': [
        [ // no insets
          [321.86645173307244, 263.18171033061026, 6.250768442967064],
          [321.8665106654679, 263.1816835030222, 6.250767805791174],
          [321.8664415146735, 263.18171498229617, 6.250768553448191],
          [321.8664317945567, 263.1817194071509, 6.2507686585419],
        ],
        [ // chrome
          [266.5616937340155, 322.17810624585, 3.9943596308381206],
          [266.5617640329073, 322.1780742439317, 3.9943588707678983],
          [266.5616682223009, 322.1781178594585, 3.9943599066702724],
          [266.56165476343983, 322.1781239862887, 3.99436005218721],
        ],
        [ // too little
          [321.86645173307244, 263.18171033061026, 6.250768442967064],
          [321.8665106654679, 263.1816835030222, 6.250767805791174],
          [321.8664415146735, 263.18171498229617, 6.250768553448191],
          [321.8664317945567, 263.1817194071509, 6.2507686585419],
        ],
      ],
    }
    const designs: Record<string, ScenePersistedState> = {
      'all': scene(),
      'no plants': { ...scene(), plants: [] },
      'notes only': { ...scene(), zones: [], plants: [] },
      'no notes': { ...scene(), annotations: [] },
    }
    for (const [name, design] of Object.entries(designs)) {
      insetCases.forEach((insets, insetCase) => {
        [0.05, 1, 14, 1000].forEach((scale, start) => {
          const frame = fitFrame(1000, 800, [3, -7, scale], insets)

          expectPlacement(fitScene(frame, { extentPoints: sceneExtentPoints(design), emptySceneScale: 0 }, 0), today[name]![insetCase]![start]!)
        })
      })
    }

    // An empty scene: today's placement under a zero empty-scene scale, else that scale (clamped) about the screen centre.
    const empty = { ...scene(), plants: [], zones: [], annotations: [] }
    const frame = fitFrame(1000, 800, [3, -7, 2])
    const todayEmpty: readonly Placement[] = [[3, -7, 2], [500, 400, 25], [500, 400, 1716.6895781438734]]
    ;[0, 25, 1e9].forEach((emptySceneScale, index) => {
      expectPlacement(fitScene(frame, { extentPoints: sceneExtentPoints(empty), emptySceneScale }, 0), todayEmpty[index]!)
    })
    const unsized = fitFrame(0, 0, [3, -7, 2])
    expect(fitScene(unsized, { extentPoints: sceneExtentPoints(scene()), emptySceneScale: 0 }, 0)).toBe(unsized.current)
  })

  it('screen-sized notes converge within 20 rounds', () => {
    const notesOnly: ScenePersistedState = {
      ...scene(),
      plants: [],
      zones: [],
      annotations: [note('a', 50, 60, 'A long annotation that affects bounds', null), note('b', 52, 61, 'Another\nnote', 30)],
    }
    for (const bearingDeg of [0, 30]) {
      for (const start of [1e-3, 1, 1000]) {
        const frame = fitFrame(1000, 800, [0, 0, start])
        const calls = { count: 0 }
        const extentPoints = countedExtent(notesOnly, calls)

        const fitted = fitScene(frame, { extentPoints, emptySceneScale: 0 }, bearingDeg)

        expect(calls.count).toBeLessThanOrEqual(20)
        expect(fitted.bearingDeg).toBe(bearingDeg)
        // A fixed point: at the fitted scale the notes fill 80 % of the limiting side of the screen.
        const span = orientedSpan(extentPoints(fitted.scale), bearingDeg)
        const filled = Math.max(span.width * fitted.scale / 1000, span.height * fitted.scale / 800)
        expect(filled).toBeCloseTo(0.8, 3)
        for (const point of extentPoints(fitted.scale)) {
          const onScreen = screenOf(fitted, point)
          expect(onScreen.x).toBeGreaterThanOrEqual(99)
          expect(onScreen.x).toBeLessThanOrEqual(901)
          expect(onScreen.y).toBeGreaterThanOrEqual(79)
          expect(onScreen.y).toBeLessThanOrEqual(721)
        }
      }
    }
  })

  it('at bearing 0 temporary focus matches today\'s fitTemporaryBoundsViewport', () => {
    const boxes = [
      { minX: 0, minY: 0, maxX: 100, maxY: 50 },
      { minX: 0, minY: 0, maxX: 0.001, maxY: 0.001 },
      { minX: -3, minY: 7, maxX: 1, maxY: 7.5 },
      { minX: 1, minY: 0, maxX: 1, maxY: 10 },
    ]
    const options = [{ paddingCssPx: 48 }, { paddingCssPx: 48, maximumScale: 2 }, { paddingCssPx: 201 }, { paddingCssPx: -1 }, { paddingCssPx: 0, maximumScale: 1e-9 }]
    // Today's fitTemporaryBoundsViewport (canvas/runtime/camera.ts:585-629 at 52cbff10) on a 400 × 300 CameraController placed
    // at { x: 10, y: 20, scale: 2 }, recorded for each insets case, box and option; null where it refused.
    const today: readonly (readonly (readonly (Placement | null)[])[])[] = [
      [ // no insets
        [[48, 74, 3.04], [100, 100, 2], null, null, null],
        [[199.14165521092806, 149.14165521092806, 1716.6895781438734], [199.999, 149.999, 2], null, null, null],
        [[276, -401, 76], [202, 135.5, 2], null, null, null],
        [null, null, null, null, null],
      ],
      [ // chrome
        [[88, 79, 2.44], [110, 90, 2], null, null, null],
        [[209.14165521092806, 139.14165521092806, 1716.6895781438734], [209.999, 139.999, 2], null, null, null],
        [[271, -302.25, 61], [212, 125.5, 2], null, null, null],
        [null, null, null, null, null],
      ],
    ]
    ;[undefined, { top: 10, right: 20, bottom: 30, left: 40 }].forEach((insets, insetCase) => {
      const frame = fitFrame(400, 300, [10, 20, 2], insets)
      boxes.forEach((box, boxIndex) => {
        options.forEach((option, optionIndex) => {
          expectPlacement(fitTemporaryBounds(frame, box, option, 0), today[insetCase]![boxIndex]![optionIndex]!)
        })
      })
    })
    expect(fitTemporaryBounds(fitFrame(0, 0, [0, 0, 1]), boxes[0]!, options[0]!, 0)).toBeNull()
  })

  it('a turned fit frames the box\'s corners, not its world-axis box', () => {
    const frame = fitFrame(400, 300, [0, 0, 1])
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 20 }

    const turned = fitTemporaryBounds(frame, box, { paddingCssPx: 10 }, 90)!

    // At 90° the 100 m side runs down the screen: the 280 px of height limit the scale.
    expect(turned.scale).toBeCloseTo(280 / 100, 12)
    expect(turned.bearingDeg).toBe(90)
    const centre = screenOf(turned, { x: 50, y: 10 })
    expect(centre.x).toBeCloseTo(200, 9)
    expect(centre.y).toBeCloseTo(150, 9)
  })

  it('frames inside the chrome insets unless they leave under 120 px', () => {
    expect(framingRect({ width: 1000, height: 800 })).toEqual({ x: 0, y: 0, width: 1000, height: 800 })
    expect(framingRect({ width: 1000, height: 800 }, { top: 40, right: 300, bottom: 20, left: 60 }))
      .toEqual({ x: 60, y: 40, width: 640, height: 740 })
    expect(framingRect({ width: 1000, height: 800 }, { top: 400, right: 0, bottom: 390, left: 0 }))
      .toEqual({ x: 0, y: 0, width: 1000, height: 800 })
    expect(framingRect({ width: 1000, height: 800 }, { top: Number.NaN, right: 0, bottom: 0, left: 0 }))
      .toEqual({ x: 0, y: 0, width: 1000, height: 800 })
  })
})

// Moved from __tests__/camera-controller.test.ts (computeSceneBounds > …): the fits' extent is canvas/runtime/scene-extent.ts's
// footprint corners, and its world-axis box is what computeSceneBounds returned.
describe('scene extent', () => {
  function boundsScene(): ScenePersistedState {
    return {
      plantSpeciesColors: {},
      plantSpeciesSymbols: {},
      plantSpeciesCodes: {},
      layers: [],
      plants: [
        {
          kind: 'plant', locked: false, id: 'p1', canonicalName: 'Malus domestica', commonName: 'Apple', color: null,
          stratum: null, canopySpreadM: null, position: { x: 10, y: 20 }, rotationDeg: null, notes: null, plantedDate: null, quantity: null,
        },
      ],
      zones: [
        {
          kind: 'zone', locked: false, id: 'z1', name: null, zoneType: 'rect',
          points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }, { x: 0, y: 40 }],
          rotationDeg: 0, fillColor: null, notes: null,
        },
      ],
      annotations: [],
      measurementGuides: [],
      groups: [],
      guides: [],
    }
  }

  /** The world-axis box of the extent at a scale (1 px/m unless given, as computeSceneBounds defaulted). */
  function extentBox(design: ScenePersistedState, pixelsPerMetre = 1): SceneBounds | null {
    return worldAxisBox(sceneExtentPoints(design)(pixelsPerMetre))
  }

  it('uses the symbolic Placed Plant Visual Footprint for plant-only bounds', () => {
    const design = boundsScene()
    design.zones = []

    const bounds = extentBox(design, 10)

    expect(bounds?.minX).toBeCloseTo(9.65, 2)
    expect(bounds?.minY).toBeCloseTo(19.65, 2)
    expect(bounds?.maxX).toBeCloseTo(10.35, 2)
    expect(bounds?.maxY).toBeCloseTo(20.35, 2)
  })

  it('includes both plant and zone geometry', () => {
    expect(extentBox(boundsScene())).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 40 })
  })

  it('includes elliptical zone center and radii geometry', () => {
    const design = boundsScene()
    design.plants = []
    design.zones = [{
      kind: 'zone', locked: false, id: 'ellipse-1', name: 'ellipse-1', zoneType: 'ellipse',
      points: [{ x: 50, y: 60 }, { x: 30, y: 20 }], rotationDeg: 0, fillColor: null, notes: null,
    }]

    expect(extentBox(design)).toEqual({ minX: 20, minY: 40, maxX: 80, maxY: 80 })
  })

  it('includes oriented Elliptical Zone bounds', () => {
    const design = boundsScene()
    design.plants = []
    design.zones = [{
      kind: 'zone', locked: false, id: 'ellipse-1', name: 'ellipse-1', zoneType: 'ellipse',
      points: [{ x: 0, y: 0 }, { x: 4, y: 1 }], rotationDeg: 90, fillColor: null, notes: null,
    }]

    expect(extentBox(design)).toEqual({ minX: -1, minY: -4, maxX: 1, maxY: 4 })
  })

  it('includes annotation extents instead of only the annotation anchor point', () => {
    const design = boundsScene()
    design.annotations = [{
      kind: 'annotation', locked: false, id: 'annotation-1', annotationType: 'text',
      position: { x: 50, y: 60 }, text: 'Long note', fontSize: 20, rotationDeg: null,
    }]

    expect(extentBox(design, 1)).toEqual({ minX: 0, minY: 0, maxX: 158, maxY: 85 })
  })

  it('an empty scene has no extent', () => {
    expect(sceneExtentPoints({ ...boundsScene(), plants: [], zones: [] })(1)).toEqual([])
  })
})
