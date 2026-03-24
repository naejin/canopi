import Konva from 'konva'

// ---------------------------------------------------------------------------
// Scale bar — fixed bottom-left of viewport.
// Lives on the Konva UI layer but uses per-node world-coord positioning and
// per-node counter-scale so the UI layer itself stays at identity transform.
// Shows a horizontal bar whose length represents a "round" real-world distance.
// ---------------------------------------------------------------------------

// Candidate distances in meters. Pick the one whose screen length is ~120px.
const NICE_DISTANCES = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
const TARGET_PX = 120
const MARGIN_X = 40   // clear the 24px vertical ruler + padding
const MARGIN_Y = 16

export interface ScaleBar {
  group: Konva.Group
  update(stage: Konva.Stage): void
}

export function createScaleBar(stage: Konva.Stage): ScaleBar {
  // All child sizes are in screen pixels; the group is counter-scaled so they
  // stay constant regardless of stage zoom.
  const line = new Konva.Line({
    points: [0, 0, TARGET_PX, 0],
    stroke: '#1A1A1A',
    strokeWidth: 2,
    strokeScaleEnabled: false,
    lineCap: 'square',
    listening: false,
  })

  const capLeft = new Konva.Line({
    points: [0, -4, 0, 4],
    stroke: '#1A1A1A',
    strokeWidth: 2,
    strokeScaleEnabled: false,
    listening: false,
  })
  const capRight = new Konva.Line({
    points: [TARGET_PX, -4, TARGET_PX, 4],
    stroke: '#1A1A1A',
    strokeWidth: 2,
    strokeScaleEnabled: false,
    listening: false,
  })

  const label = new Konva.Text({
    x: 0,
    y: -18,
    text: '',
    fontSize: 11,
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fill: '#1A1A1A',
    listening: false,
    align: 'center',
  })

  const group = new Konva.Group({ listening: false })
  group.add(line, capLeft, capRight, label)

  function update(s: Konva.Stage): void {
    const scale = s.scaleX()
    const stagePos = s.position()
    const stageH = s.height()
    const inv = 1 / scale

    // Find the best-fit distance
    let bestDist = NICE_DISTANCES[0]!
    for (const d of NICE_DISTANCES) {
      if (d * scale <= TARGET_PX * 1.5) {
        bestDist = d
      } else {
        break
      }
    }

    // Bar width in screen pixels
    const barScreenPx = bestDist * scale

    // Position the group at bottom-left in world coordinates.
    // screen position → world position via inverse stage transform.
    const worldX = (MARGIN_X - stagePos.x) * inv
    const worldY = (stageH - MARGIN_Y - stagePos.y) * inv

    group.position({ x: worldX, y: worldY })
    // Counter-scale the group so its children stay at screen-pixel sizes
    group.scale({ x: inv, y: inv })

    // Update bar width (in screen pixels, since group is counter-scaled)
    line.points([0, 0, barScreenPx, 0])
    capLeft.points([0, -4, 0, 4])
    capRight.points([barScreenPx, -4, barScreenPx, 4])

    const distLabel = _formatDist(bestDist)
    label.text(distLabel)
    label.x(barScreenPx / 2 - label.width() / 2)
    label.y(-18)

    // Update stroke colors for dark/light mode
    const cs = getComputedStyle(s.container())
    const color = cs.getPropertyValue('--color-text').trim() || '#1A1A1A'
    line.stroke(color)
    capLeft.stroke(color)
    capRight.stroke(color)
    label.fill(color)
  }

  // Initial paint
  update(stage)

  return { group, update }
}

function _formatDist(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(0)} km`
  if (meters < 1) return `${(meters * 100).toFixed(0)} cm`
  return `${meters % 1 === 0 ? meters.toFixed(0) : meters.toFixed(1)} m`
}
