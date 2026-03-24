import Konva from 'konva'
import { northBearingDeg } from '../state/canvas'

// ---------------------------------------------------------------------------
// Compass widget — a clean, professional north arrow inspired by Google Maps.
// Draggable, rotatable (scroll wheel), double-click to reset to 0°.
// ---------------------------------------------------------------------------

const MARGIN = 48         // px from viewport edge
const OUTER_R = 16        // outer circle radius (screen px)
const NEEDLE_LEN = 10     // needle half-length from center (screen px)
const NEEDLE_W = 5        // needle base width (screen px)

export interface Compass {
  group: Konva.Group
  update(stage: Konva.Stage): void
}

export function createCompass(stage: Konva.Stage): Compass {
  // Outer ring — subtle, clean circle
  const ring = new Konva.Circle({
    radius: OUTER_R,
    fill: 'rgba(255,255,255,0.92)',
    stroke: 'rgba(0,0,0,0.12)',
    strokeWidth: 1,
    strokeScaleEnabled: false,
    shadowColor: 'rgba(0,0,0,0.12)',
    shadowBlur: 6,
    shadowOffsetY: 1,
    listening: true,
  })

  // North needle — filled red triangle pointing up
  const northNeedle = new Konva.Line({
    points: [0, -NEEDLE_LEN, -NEEDLE_W / 2, 0, NEEDLE_W / 2, 0],
    fill: '#D32F2F',
    closed: true,
    listening: false,
  })

  // South needle — filled light grey triangle pointing down
  const southNeedle = new Konva.Line({
    points: [0, NEEDLE_LEN, -NEEDLE_W / 2, 0, NEEDLE_W / 2, 0],
    fill: '#E0E0E0',
    closed: true,
    listening: false,
  })

  // Center dot — small circle at the pivot
  const centerDot = new Konva.Circle({
    radius: 2,
    fill: '#666666',
    listening: false,
  })

  // "N" label — small, positioned above the ring
  const nLabel = new Konva.Text({
    text: 'N',
    fontSize: 9,
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontStyle: 'bold',
    fill: '#D32F2F',
    listening: false,
    align: 'center',
  })
  nLabel.offsetX(nLabel.width() / 2)
  nLabel.y(-OUTER_R - 12)

  // Inner group carries the bearing rotation (needle + N label rotate together)
  const arrowGroup = new Konva.Group({ listening: false })
  arrowGroup.add(ring, southNeedle, northNeedle, centerDot, nLabel)
  arrowGroup.rotation(northBearingDeg.value)

  // Outer group is draggable and holds everything
  const group = new Konva.Group({
    draggable: true,
    listening: true,
  })
  group.add(arrowGroup)

  // Double-click to reset bearing to 0°
  group.on('dblclick dbltap', () => {
    northBearingDeg.value = 0
    arrowGroup.rotation(0)
    group.getLayer()?.batchDraw()
  })

  // Scroll wheel rotates the bearing
  ring.on('wheel', (e) => {
    e.evt.stopPropagation()
    const delta = e.evt.deltaY > 0 ? 5 : -5
    northBearingDeg.value = (northBearingDeg.value + delta + 360) % 360
    arrowGroup.rotation(northBearingDeg.value)
    group.getLayer()?.batchDraw()
  })

  // Track manual drag
  let _userDragged = false
  group.on('dragstart', () => { _userDragged = true })

  function update(s: Konva.Stage): void {
    const scale = s.scaleX()
    const stagePos = s.position()
    const stageW = s.width()
    const inv = 1 / scale

    if (!_userDragged) {
      const screenX = stageW - MARGIN
      const screenY = MARGIN
      const worldX = (screenX - stagePos.x) * inv
      const worldY = (screenY - stagePos.y) * inv
      group.position({ x: worldX, y: worldY })
    }

    group.scale({ x: inv, y: inv })
  }

  update(stage)
  return { group, update }
}
