import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../ipc/species', () => ({
  getSpeciesBatch: vi.fn(async () => []),
  getFlowerColorBatch: vi.fn(async () => []),
  getCommonNames: vi.fn(async () => ({})),
}))

import { geoAt } from '../../../__tests__/support/geo-design'
import { CURRENT_CANOPI_FILE_VERSION } from '../../../generated/canopi-design-format'
import type { CanopiFile } from '../../../types/design'
import { geographicExtentOf, geographicViewOf, type GeoPosition } from '../../session-plane'
import type { CameraController } from '../camera'
import { SceneCanvasRuntime } from '../scene-runtime'

const SCREEN = { width: 400, height: 300 }

function designAt(origin: GeoPosition, name: string): CanopiFile {
  return {
    version: CURRENT_CANOPI_FILE_VERSION,
    name,
    description: null,
    plant_species_colors: {},
    layers: [
      { name: 'plants', visible: true, locked: false, opacity: 1 },
      { name: 'zones', visible: true, locked: false, opacity: 1 },
      { name: 'annotations', visible: true, locked: false, opacity: 1 },
    ],
    plants: [],
    zones: [{
      id: 'bed', name: 'bed', zone_type: 'rect', rotation: 0,
      points: [geoAt(0, 0, origin), geoAt(8, 0, origin), geoAt(8, 6, origin), geoAt(0, 6, origin)],
      fill_color: null, notes: null, locked: false,
    }],
    annotations: [],
    measurement_guides: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-09-30T00:00:00.000Z',
    updated_at: '2026-09-30T00:00:00.000Z',
  }
}

function legacyCamera(runtime: SceneCanvasRuntime): CameraController {
  return (runtime as unknown as { _camera: CameraController })._camera
}

/** Today's reads: the plane viewport interpreted on the Scene's plane (current-view.ts, controller.ts before 0A-2). */
function todaysCapture(runtime: SceneCanvasRuntime) {
  const frame = runtime.querySurface.viewport.peek()
  const plane = runtime.querySurface.sessionPlane.peek()!
  return { view: geographicViewOf(frame, plane), extent: geographicExtentOf(frame, plane) }
}

describe('the runtime view surfaces', () => {
  it('capture the Design\'s ground on a headless runtime, before and after a hydration replaces the plane', () => {
    const runtime = new SceneCanvasRuntime()
    try {
      runtime.documentSurface.loadDocument(designAt({ lon: 2.35, lat: 48.85 }, 'Paris'))
      runtime.documentSurface.resize(SCREEN.width, SCREEN.height)
      legacyCamera(runtime).setViewport({ x: 120.5, y: -40.25, scale: 3.5 })

      for (const design of [null, designAt({ lon: -71.06, lat: 42.36 }, 'Boston')]) {
        if (design) runtime.documentSurface.loadDocument(design)
        const today = todaysCapture(runtime)
        const captured = runtime.querySurface.view.captureView()
        // At bearing 0 the headless camera is today's arithmetic, bit for bit.
        expect(captured.camera).toEqual({
          center: { lon: today.view!.lon, lat: today.view!.lat },
          zoom: today.view!.zoom,
          bearingDeg: 0,
          pitchDeg: 0,
        })
        expect(captured.extent).toEqual(today.extent)
        expect(captured.screen).toEqual({ ...SCREEN, devicePixelRatio: 1 })
        expect(runtime.querySurface.view.settledCamera.peek()).toBeDefined()
      }
      // The hydration kept the plane placement.
      expect(runtime.querySurface.viewport.peek().viewport).toEqual({ x: 120.5, y: -40.25, scale: 3.5 })
    } finally {
      runtime.destroy()
    }
  })

  it('show a camera and fit the selection through the runtime\'s camera', () => {
    const runtime = new SceneCanvasRuntime()
    try {
      const origin = { lon: 2.35, lat: 48.85 }
      runtime.documentSurface.loadDocument(designAt(origin, 'Paris'))
      runtime.documentSurface.resize(SCREEN.width, SCREEN.height)
      const plane = runtime.querySurface.sessionPlane.peek()!
      const target = plane.toGeo({ x: 30, y: -20 })

      runtime.commandSurface.viewport.showCamera({ center: target, zoom: 19, bearingDeg: 30, pitchDeg: 0 }, { motion: 'jump' })

      const shown = runtime.querySurface.view.captureView().camera
      expect(shown.center.lon).toBeCloseTo(target.lon, 9)
      expect(shown.center.lat).toBeCloseTo(target.lat, 9)
      expect(shown.zoom).toBeCloseTo(19, 9)
      expect(shown.bearingDeg).toBe(30)
      expect(runtime.querySurface.view.bearingDeg.peek()).toBe(30)

      runtime.commandSurface.sceneEdits.selectAll()
      runtime.commandSurface.viewport.zoomToSelection()

      // The bed fills the screen at the kept bearing: its centre is the screen centre's ground.
      const fitted = runtime.querySurface.view.captureView().camera
      expect(fitted.bearingDeg).toBe(30)
      const bedCentre = plane.toPlane(fitted.center)
      const bed = runtime.querySurface.getDesignObjectSelection().bounds!
      expect(bedCentre.x).toBeCloseTo((bed.minX + bed.maxX) / 2, 6)
      expect(bedCentre.y).toBeCloseTo((bed.minY + bed.maxY) / 2, 6)
      expect(fitted.zoom).toBeGreaterThan(19)
    } finally {
      runtime.destroy()
    }
  })
})
