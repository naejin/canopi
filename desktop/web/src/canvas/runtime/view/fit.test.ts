import { describe, expect, it } from 'vitest'
import { cameraScaleBoundsForPolicy, createWorkspaceCameraPolicy } from '../../workspace-camera-policy'
import { getAnnotationWorldBounds } from '../annotation-layout'
import { getPlantWorldBounds } from '../plant-presentation'
import { sceneExtentPoints } from '../scene-extent'
import type { SceneAnnotationEntity, ScenePersistedState } from '../scene'
import { getZoneWorldBounds } from '../zone-geometry'
import { fitScene, fitTemporaryBounds, framingRect, type FitFrame } from './fit'
import type { PlanarCamera, SceneBounds, ScreenInsets, TemporaryBoundsFocusOptions, WorldPoint } from './types'

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

/** Corner points of every plant, zone and note footprint at a scale, from the helpers today's computeSceneBounds reads. */
function extentPointsOf(design: ScenePersistedState, calls?: { count: number }) {
  return (pixelsPerMetre: number): WorldPoint[] => {
    if (calls) calls.count += 1
    const points: WorldPoint[] = []
    const corners = (box: { x: number; y: number; width: number; height: number }) => {
      points.push({ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }, { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height })
    }
    for (const plant of design.plants) {
      corners(getPlantWorldBounds(plant, { viewport: { x: 0, y: 0, scale: pixelsPerMetre }, speciesCache: new Map(), plants: design.plants }))
    }
    for (const zone of design.zones) {
      const box = getZoneWorldBounds(zone)
      if (box) corners(box)
    }
    for (const annotation of design.annotations) corners(getAnnotationWorldBounds(annotation, pixelsPerMetre))
    return points
  }
}

interface Viewport { readonly x: number; readonly y: number; readonly scale: number }

/** What today's CameraController snapshot held for a placement on a screen, and the fit frame built from it. */
interface TodaySnapshot {
  readonly viewport: Viewport
  readonly screenSize: { readonly width: number; readonly height: number }
  readonly scaleBounds: { readonly minimum: number; readonly maximum: number }
}

/** Today's snapshot at a placement (its scale bounds were the policy's), and the fit frame built from it. */
function todayAndFrame(width: number, height: number, placement: Viewport, insets?: ScreenInsets) {
  const snapshot: TodaySnapshot = {
    viewport: placement,
    screenSize: { width, height },
    scaleBounds: cameraScaleBoundsForPolicy(createWorkspaceCameraPolicy()),
  }
  const frame: FitFrame = {
    screen: { width, height },
    insets,
    scaleBounds: { min: snapshot.scaleBounds.minimum, max: snapshot.scaleBounds.maximum },
    current: { ...placement, bearingDeg: 0 },
  }
  return { snapshot, frame }
}

// The oracle: today's fitCameraViewport and fitTemporaryBoundsViewport (canvas/runtime/camera.ts:519-629 at 52cbff10), frozen here
// when camera.ts became the legacy facade (0A-1d). Their scene bounds are computeSceneBounds's world-axis box of the footprints.

const NO_INSETS: ScreenInsets = { top: 0, right: 0, bottom: 0, left: 0 }

function todayClamp(scale: number, bounds: TodaySnapshot['scaleBounds']): number {
  return Math.min(bounds.maximum, Math.max(bounds.minimum, scale))
}

function todayFramingRect(screen: TodaySnapshot['screenSize'], insets: ScreenInsets = NO_INSETS) {
  const width = screen.width - insets.left - insets.right
  const height = screen.height - insets.top - insets.bottom
  if (![width, height].every(Number.isFinite) || width < 120 || height < 120) {
    return { x: 0, y: 0, width: screen.width, height: screen.height }
  }
  return { x: insets.left, y: insets.top, width, height }
}

function todayBounds(points: readonly WorldPoint[]): SceneBounds | null {
  if (points.length === 0) return null
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  }
}

function todayFitCameraViewport(
  snapshot: TodaySnapshot,
  design: ScenePersistedState,
  emptySceneScale: number | undefined,
  insets: ScreenInsets = NO_INSETS,
): Viewport {
  if (snapshot.screenSize.width <= 0 || snapshot.screenSize.height <= 0) return { ...snapshot.viewport }
  const screen = todayFramingRect(snapshot.screenSize, insets)
  let currentScale = snapshot.viewport.scale
  let bounds: SceneBounds | null = null
  let scale = currentScale
  for (let i = 0; i < 20; i++) {
    bounds = todayBounds(extentPointsOf(design)(currentScale))
    if (!bounds) {
      if (emptySceneScale === undefined || !(emptySceneScale > 0)) return { ...snapshot.viewport }
      const emptyScale = todayClamp(emptySceneScale, snapshot.scaleBounds)
      return { x: snapshot.screenSize.width / 2, y: snapshot.screenSize.height / 2, scale: emptyScale }
    }
    const contentWidth = Math.max(bounds.maxX - bounds.minX, 1)
    const contentHeight = Math.max(bounds.maxY - bounds.minY, 1)
    scale = todayClamp(Math.min(
      (screen.width * (1 - 0.1 * 2)) / contentWidth,
      (screen.height * (1 - 0.1 * 2)) / contentHeight,
    ), snapshot.scaleBounds)
    if (Math.abs(scale - currentScale) / Math.max(scale, currentScale) < 0.0001) break
    currentScale = scale
  }
  const finalBounds = bounds!
  const contentWidth = Math.max(finalBounds.maxX - finalBounds.minX, 1)
  const contentHeight = Math.max(finalBounds.maxY - finalBounds.minY, 1)
  return {
    x: screen.x + (screen.width - contentWidth * scale) / 2 - finalBounds.minX * scale,
    y: screen.y + (screen.height - contentHeight * scale) / 2 - finalBounds.minY * scale,
    scale,
  }
}

function todayFitTemporaryBoundsViewport(
  snapshot: TodaySnapshot,
  bounds: SceneBounds,
  options: TemporaryBoundsFocusOptions,
  insets: ScreenInsets = NO_INSETS,
): Viewport | null {
  const { width: screenWidth, height: screenHeight } = snapshot.screenSize
  if (!Number.isFinite(screenWidth) || !Number.isFinite(screenHeight) || screenWidth <= 0 || screenHeight <= 0) return null
  const frame = todayFramingRect(snapshot.screenSize, insets)
  const { width, height } = frame
  const { minX, minY, maxX, maxY } = bounds
  const padding = options.paddingCssPx
  const maximumScale = options.maximumScale ?? snapshot.scaleBounds.maximum
  if (
    ![width, height, minX, minY, maxX, maxY, padding, maximumScale].every(Number.isFinite)
    || width <= 0
    || height <= 0
    || minX >= maxX
    || minY >= maxY
    || padding < 0
    || maximumScale < snapshot.scaleBounds.minimum
  ) return null
  const availableWidth = width - padding * 2
  const availableHeight = height - padding * 2
  if (availableWidth <= 0 || availableHeight <= 0) return null
  const scale = todayClamp(Math.min(
    availableWidth / (maxX - minX),
    availableHeight / (maxY - minY),
    maximumScale,
  ), snapshot.scaleBounds)
  if (!Number.isFinite(scale) || scale > maximumScale) return null
  return {
    x: frame.x + width / 2 - ((minX + maxX) / 2) * scale,
    y: frame.y + height / 2 - ((minY + maxY) / 2) * scale,
    scale,
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
    const insetCases: Array<ScreenInsets | undefined> = [
      undefined,
      { top: 40, right: 300, bottom: 20, left: 60 },
      { top: 400, right: 0, bottom: 390, left: 0 }, // leaves under 120 px: the whole screen frames
    ]
    const designs = [scene(), { ...scene(), plants: [] }, { ...scene(), zones: [], plants: [] }, { ...scene(), annotations: [] }]
    for (const design of designs) {
      for (const insets of insetCases) {
        for (const scale of [0.05, 1, 14, 1000]) {
          const { snapshot, frame } = todayAndFrame(1000, 800, { x: 3, y: -7, scale }, insets)
          const today = todayFitCameraViewport(snapshot, design, undefined, insets)

          expect(fitScene(frame, { extentPoints: extentPointsOf(design) }, 0)).toEqual({ ...today, bearingDeg: 0 })
        }
      }
    }

    const empty = { ...scene(), plants: [], zones: [], annotations: [] }
    const { snapshot, frame } = todayAndFrame(1000, 800, { x: 3, y: -7, scale: 2 })
    for (const emptySceneScale of [undefined, 0, 25, 1e9]) {
      const today = todayFitCameraViewport(snapshot, empty, emptySceneScale, undefined)
      expect(fitScene(frame, { extentPoints: extentPointsOf(empty), emptySceneScale }, 0)).toEqual({ ...today, bearingDeg: 0 })
    }
    const unsized = todayAndFrame(0, 0, { x: 3, y: -7, scale: 2 })
    expect(fitScene(unsized.frame, { extentPoints: extentPointsOf(scene()) }, 0)).toBe(unsized.frame.current)
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
        const { frame } = todayAndFrame(1000, 800, { x: 0, y: 0, scale: start })
        const calls = { count: 0 }
        const extentPoints = extentPointsOf(notesOnly, calls)

        const fitted = fitScene(frame, { extentPoints }, bearingDeg)

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
    for (const insets of [undefined, { top: 10, right: 20, bottom: 30, left: 40 }]) {
      const { snapshot, frame } = todayAndFrame(400, 300, { x: 10, y: 20, scale: 2 }, insets)
      for (const box of boxes) {
        for (const option of options) {
          const today = todayFitTemporaryBoundsViewport(snapshot, box, option, insets)
          expect(fitTemporaryBounds(frame, box, option, 0)).toEqual(today && { ...today, bearingDeg: 0 })
        }
      }
    }
    const unsized = todayAndFrame(0, 0, { x: 0, y: 0, scale: 1 })
    expect(fitTemporaryBounds(unsized.frame, boxes[0]!, options[0]!, 0)).toBeNull()
  })

  it('a turned fit frames the box\'s corners, not its world-axis box', () => {
    const { frame } = todayAndFrame(400, 300, { x: 0, y: 0, scale: 1 })
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
    return todayBounds(sceneExtentPoints(design)(pixelsPerMetre))
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
