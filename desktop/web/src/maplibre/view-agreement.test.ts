import { describe, expect, it, vi } from 'vitest'
import { geoToMercator, mercatorToGeo } from '../canvas/projection'
import type { ViewCamera, ViewScreen } from '../canvas/runtime/view/types'
import { buildViewTransform } from '../canvas/runtime/view/view-transform'
import { createSessionPlane } from '../canvas/session-plane'
import { assertViewAgreement } from './view-agreement'

const SCREEN: ViewScreen = { width: 1000, height: 800, devicePixelRatio: 2 }
const PLANE = createSessionPlane({ lon: 2.35, lat: 48.85 })

/** MapLibre's unproject at pitch 0: Web Mercator at 512-px tiles, the screen turned by the bearing about its centre. */
function unprojectLike(camera: ViewCamera, screen: ViewScreen, errorPx = { x: 0, y: 0 }) {
  return vi.fn(([x, y]: [number, number]) => {
    const worldSize = 512 * 2 ** camera.zoom
    const centre = geoToMercator(camera.center.lon, camera.center.lat)
    const radians = camera.bearingDeg * Math.PI / 180
    const dx = x + errorPx.x - screen.width / 2
    const dy = y + errorPx.y - screen.height / 2
    return mercatorToGeo(
      centre.x + (Math.cos(radians) * dx - Math.sin(radians) * dy) / worldSize,
      centre.y + (Math.sin(radians) * dx + Math.cos(radians) * dy) / worldSize,
    )
  })
}

describe('view agreement probe', () => {
  it('agrees with map.unproject within 0.01 px at bearing 0', () => {
    for (const camera of [
      { center: { lon: 2.3512, lat: 48.8534 }, zoom: 19.25, bearingDeg: 0, pitchDeg: 0 },
      { center: { lon: 2.2, lat: 48.9 }, zoom: 11, bearingDeg: 0, pitchDeg: 0 },
      { center: { lon: 2.35, lat: 48.85 }, zoom: 27, bearingDeg: 0, pitchDeg: 0 },
    ] satisfies ViewCamera[]) {
      const unproject = unprojectLike(camera, SCREEN)
      const view = buildViewTransform({ camera, screen: SCREEN, plane: PLANE, planeRevision: 0, revision: 1 })

      const { maxErrorPx } = assertViewAgreement({ unproject }, view, PLANE)

      expect(maxErrorPx).toBeLessThan(0.01)
      // unproject only, at the four points 25 % and 75 % across and down.
      expect(unproject.mock.calls.map(([point]) => point)).toEqual([
        [250, 200], [250, 600], [750, 200], [750, 600],
      ])
    }
  })

  it('a disagreement throws in tests', () => {
    const camera: ViewCamera = { center: { lon: 2.3512, lat: 48.8534 }, zoom: 19.25, bearingDeg: 30, pitchDeg: 0 }
    const view = buildViewTransform({ camera, screen: SCREEN, plane: PLANE, planeRevision: 0, revision: 1 })

    // A rotated camera agrees too: rotation is never a failure.
    expect(assertViewAgreement({ unproject: unprojectLike(camera, SCREEN) }, view, PLANE).maxErrorPx).toBeLessThan(0.01)
    expect(() => assertViewAgreement({ unproject: unprojectLike(camera, SCREEN, { x: 0.02, y: 0 }) }, view, PLANE))
      .toThrow(/0\.02\d* px/)
    const north = { ...camera, bearingDeg: 0 }
    expect(() => assertViewAgreement({ unproject: unprojectLike(north, SCREEN) }, view, PLANE)).toThrow('agree')
  })
})
