// __tests__/support/plane-viewport-corners.ts  (test support)
//
// The lon/lat box of a bearing-0 plane viewport's north-west and south-east screen corners: what session-plane.ts's
// geographicExtentOf measured before its one-world check, when the saved views read the plane viewport (before 0A-2). Tests
// compare ViewReadSurface.captureView's extent with it, and pass it through extentOnOneWorld as the saved views now do.

import type { GeographicExtent, SessionPlane } from '../../canvas/session-plane'

export function planeViewportCornerBounds(
  frame: {
    readonly viewport: { readonly x: number; readonly y: number; readonly scale: number }
    readonly screenSize: { readonly width: number; readonly height: number }
  },
  plane: SessionPlane,
): GeographicExtent {
  const { viewport, screenSize } = frame
  const northWest = plane.toGeo({ x: -viewport.x / viewport.scale, y: -viewport.y / viewport.scale })
  const southEast = plane.toGeo({
    x: (screenSize.width - viewport.x) / viewport.scale,
    y: (screenSize.height - viewport.y) / viewport.scale,
  })
  return { west: northWest.lon, south: southEast.lat, east: southEast.lon, north: northWest.lat }
}
