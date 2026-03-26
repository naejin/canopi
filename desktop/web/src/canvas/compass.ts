import Konva from 'konva'
import { northBearingDeg } from '../state/canvas'

// ---------------------------------------------------------------------------
// Compass widget — a clean, professional north arrow inspired by Google Maps.
// Draggable, rotatable (scroll wheel), double-click to reset to 0°.
// ---------------------------------------------------------------------------

const MARGIN = 40         // px from viewport edge
const OUTER_R = 12        // outer circle radius (screen px)
const NEEDLE_LEN = 8      // needle half-length from center (screen px)
const NEEDLE_W = 4        // needle base width (screen px)

export interface Compass {
  group: Konva.Group
  update(stage: Konva.Stage): void
}

export function createCompass(stage: Konva.Stage): Compass {
  // Outer ring — warm, subtle
  const ring = new Konva.Circle({
    radius: OUTER_R,
    fill: 'rgba(240, 235, 225, 0.85)',
    stroke: 'rgba(60, 45, 30, 0.15)',
    strokeWidth: 1,
    strokeScaleEnabled: false,
    listening: true,
  })

  // North needle — warm terracotta
  const northNeedle = new Konva.Line({
    points: [0, -NEEDLE_LEN, -NEEDLE_W / 2, 0, NEEDLE_W / 2, 0],
    fill: '#B5432A',
    closed: true,
    listening: false,
  })

  // South needle — muted parchment
  const southNeedle = new Konva.Line({
    points: [0, NEEDLE_LEN, -NEEDLE_W / 2, 0, NEEDLE_W / 2, 0],
    fill: 'rgba(60, 45, 30, 0.15)',
    closed: true,
    listening: false,
  })

  // Center dot
  const centerDot = new Konva.Circle({
    radius: 1.5,
    fill: 'rgba(60, 45, 30, 0.4)',
    listening: false,
  })

  // "N" label — small, warm
  const nLabel = new Konva.Text({
    text: 'N',
    fontSize: 8,
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontStyle: '600',
    fill: '#B5432A',
    listening: false,
    align: 'center',
  })
  nLabel.offsetX(nLabel.width() / 2)
  nLabel.y(-OUTER_R - 10)

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
