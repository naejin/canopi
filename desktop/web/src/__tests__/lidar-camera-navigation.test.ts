import { afterEach, describe, expect, it } from 'vitest'
import {
  mapZoomToStageScale,
  stageScaleToMapZoom,
} from '../canvas/projection'
import { setCurrentCanvasSession } from '../canvas/session'
import { CameraController } from '../canvas/runtime/camera'
import {
  lidarBoundsToLocalWorld,
  viewDesignLocation,
  viewLidarCoverage,
} from '../app/lidar/camera-request'
import { designSessionFixture } from './support/design-session-state'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'
import type { CanopiFile, SpatialFrame } from '../types/design'

const confirmedFrame: SpatialFrame = {
  anchor_longitude_deg: 2.3522,
  anchor_latitude_deg: 48.8566,
  north_bearing_deg: 32,
  placement_status: 'confirmed',
  location_metadata: { altitude_m: null },
}

function design(frame: SpatialFrame = confirmedFrame): CanopiFile {
  return {
    version: 6,
    name: 'LiDAR camera fixture',
    description: null,
    spatial_frame: frame,
    plant_species_colors: {},
    layers: [], plants: [], zones: [], annotations: [], consortiums: [], groups: [], timeline: [], budget: [],
    budget_currency: 'EUR',
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', extra: {},
  }
}

afterEach(() => {
  setCurrentCanvasSession(null)
  designSessionFixture.file = null
})

describe('LiDAR workspace camera navigation', () => {
  it('maps east/west to local x and north/south to local y at zero bearing', () => {
    const frame = { ...confirmedFrame, north_bearing_deg: 0 }
    const result = lidarBoundsToLocalWorld([2.34, 48.85, 2.37, 48.87], frame)

    expect(result).not.toBeNull()
    expect(result!.minX).toBeLessThan(0)
    expect(result!.maxX).toBeGreaterThan(0)
    expect(result!.minY).toBeLessThan(0)
    expect(result!.maxY).toBeGreaterThan(0)
  })

  it('converts all four geographic corners through a nonzero-bearing local frame', () => {
    const bounds: [number, number, number, number] = [2.34, 48.85, 2.37, 48.87]
    const result = lidarBoundsToLocalWorld(bounds, confirmedFrame)

    // Independent control values calculated from the EPSG:3857 equations and
    // the 32-degree local-frame rotation, rather than the production helper.
    expect(result?.minX).toBeCloseTo(-1145.806076477453, 8)
    expect(result?.minY).toBeCloseTo(-1736.7554808102204, 8)
    expect(result?.maxX).toBeCloseTo(1894.066980727929, 8)
    expect(result?.maxY).toBeCloseTo(1312.420434397319, 8)
  })

  it('focuses and returns only the live Canvas viewport while retaining the first bookmark', () => {
    const camera = new CameraController()
    camera.initialize({ width: 800, height: 600 })
    camera.setViewport({ x: 30, y: 40, scale: 2 })
    const before = camera.snapshot.value.viewport
    const file = design()
    const beforeDesign = structuredClone(file)
    designSessionFixture.file = file
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        viewport: {
          focusTemporaryBounds: (bounds, options) => camera.focusTemporaryBounds(bounds, options),
          returnFromTemporaryFocus: () => camera.returnFromTemporaryFocus(),
        },
      }),
    }))

    expect(viewLidarCoverage([2.34, 48.85, 2.37, 48.87])).toBe(true)
    expect(camera.viewport).not.toEqual(before)
    const afterFirstFocus = camera.snapshot.value.revision
    expect(viewLidarCoverage([2.345, 48.852, 2.35, 48.858])).toBe(true)
    expect(camera.snapshot.value.revision).toBeGreaterThan(afterFirstFocus)
    expect(viewDesignLocation()).toBe(true)
    expect(camera.viewport).toEqual(before)
    expect(viewDesignLocation()).toBe(false)
    expect(file).toEqual(beforeDesign)
    const scaleAtMapZoom18 = mapZoomToStageScale(18, confirmedFrame.anchor_latitude_deg)
    expect(scaleAtMapZoom18).toBeGreaterThan(0.1)
    expect(stageScaleToMapZoom(scaleAtMapZoom18, confirmedFrame.anchor_latitude_deg)).toBeCloseTo(18, 12)
  })

  it('rejects invalid bounds, unconfirmed placement, and missing canvas commands without mutation', () => {
    const camera = new CameraController()
    camera.initialize({ width: 800, height: 600 })
    const before = camera.snapshot.value
    designSessionFixture.file = design({ ...confirmedFrame, placement_status: 'provisional' })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        viewport: {
          focusTemporaryBounds: (bounds, options) => camera.focusTemporaryBounds(bounds, options),
          returnFromTemporaryFocus: () => camera.returnFromTemporaryFocus(),
        },
      }),
    }))

    expect(viewLidarCoverage([2.37, 48.85, 2.34, 48.87])).toBe(false)
    expect(viewLidarCoverage([2.34, 48.85, 2.37, 48.87])).toBe(false)
    setCurrentCanvasSession(null)
    designSessionFixture.file = design()
    expect(viewLidarCoverage([2.34, 48.85, 2.37, 48.87])).toBe(false)
    expect(camera.snapshot.value).toBe(before)
  })
})
