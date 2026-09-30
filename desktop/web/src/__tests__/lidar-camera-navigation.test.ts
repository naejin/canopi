import { afterEach, describe, expect, it } from 'vitest'
import { signal } from '@preact/signals'
import {
  mapZoomToStageScale,
  stageScaleToMapZoom,
} from '../canvas/projection'
import { setCurrentCanvasSession } from '../canvas/session'
import { planarCameraOf } from '../canvas/runtime/view/view-transform'
import { createSessionPlane, type SessionPlane } from '../canvas/session-plane'
import {
  lidarBoundsToLocalWorld,
  viewDesignLocation,
  viewLidarCoverage,
} from '../app/lidar/camera-request'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { createTestView, type TestView } from './support/test-view'

const plane = createSessionPlane({ lon: 2.3522, lat: 48.8566 })

function surfacesFor(view: TestView, sessionPlane: SessionPlane | null) {
  return createTestCanvasRuntimeSurfaces({
    queries: { ...createTestCanvasQuerySurface(), sessionPlane: signal(sessionPlane) },
    commands: createTestCanvasCommandSurface({
      viewport: {
        focusTemporaryBounds: (bounds, options) => view.navigation.focusTemporaryBounds(bounds, options),
        returnFromTemporaryFocus: () => view.navigation.returnFromTemporaryFocus(),
      },
    }),
  })
}

afterEach(() => {
  setCurrentCanvasSession(null)
})

describe('LiDAR workspace camera navigation', () => {
  it('maps east/west to plane x and north/south to plane y', () => {
    const result = lidarBoundsToLocalWorld([2.34, 48.85, 2.37, 48.87], plane)

    expect(result).not.toBeNull()
    expect(result!.minX).toBeLessThan(0)
    expect(result!.maxX).toBeGreaterThan(0)
    expect(result!.minY).toBeLessThan(0)
    expect(result!.maxY).toBeGreaterThan(0)
  })

  it('converts the geographic corners into the north-up session plane', () => {
    const result = lidarBoundsToLocalWorld([2.34, 48.85, 2.37, 48.87], plane)

    // Independent control values calculated from the EPSG:3857 equations
    // scaled at the plane origin latitude, rather than the production helper.
    expect(result?.minX).toBeCloseTo(-892.5561821919251, 6)
    expect(result?.minY).toBeCloseTo(-1490.2135517832344, 6)
    expect(result?.maxX).toBeCloseTo(1302.2541018865995, 6)
    expect(result?.maxY).toBeCloseTo(733.8391557054397, 6)
  })

  it('returns null without a session plane', () => {
    expect(lidarBoundsToLocalWorld([2.34, 48.85, 2.37, 48.87], null)).toBeNull()
  })

  it('focuses and returns only the live Canvas viewport while retaining the first bookmark', () => {
    const view = createTestView({ screen: { width: 800, height: 600 }, viewport: { x: 30, y: 40, scale: 2 } })
    const before = planarCameraOf(view.view())
    setCurrentCanvasSession(surfacesFor(view, plane))

    expect(viewLidarCoverage([2.34, 48.85, 2.37, 48.87])).toBe(true)
    expect(planarCameraOf(view.view())).not.toEqual(before)
    const afterFirstFocus = view.frames.viewFrame.value.revision
    expect(viewLidarCoverage([2.345, 48.852, 2.35, 48.858])).toBe(true)
    expect(view.frames.viewFrame.value.revision).toBeGreaterThan(afterFirstFocus)
    expect(viewDesignLocation()).toBe(true)
    expect(planarCameraOf(view.view())).toEqual(before)
    expect(viewDesignLocation()).toBe(false)
    const scaleAtMapZoom18 = mapZoomToStageScale(18, plane.origin.lat)
    expect(scaleAtMapZoom18).toBeGreaterThan(0.1)
    expect(stageScaleToMapZoom(scaleAtMapZoom18, plane.origin.lat)).toBeCloseTo(18, 12)
  })

  it('rejects invalid bounds, a missing session plane, and missing canvas commands without moving the camera', () => {
    // Today's initial 800 × 600 frame.
    const view = createTestView({ screen: { width: 800, height: 600 }, viewport: { x: 100, y: 0, scale: 6 } })
    const before = view.frames.viewFrame.value
    setCurrentCanvasSession(surfacesFor(view, plane))

    expect(viewLidarCoverage([2.37, 48.85, 2.34, 48.87])).toBe(false)
    setCurrentCanvasSession(surfacesFor(view, null))
    expect(viewLidarCoverage([2.34, 48.85, 2.37, 48.87])).toBe(false)
    setCurrentCanvasSession(null)
    expect(viewLidarCoverage([2.34, 48.85, 2.37, 48.87])).toBe(false)
    expect(view.frames.viewFrame.value).toBe(before)
  })
})
