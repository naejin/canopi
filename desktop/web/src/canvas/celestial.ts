import Konva from 'konva'
import SunCalc from 'suncalc'

// ---------------------------------------------------------------------------
// Celestial Dial — game-style sun/moon phase ring around the compass rose
//
// Driven by: design location + selected timeline action date
// No design-start-date fallback — only visible for dated actions.
// ---------------------------------------------------------------------------

const RING_OUTER_R = 50   // screen pixels — outer radius of the ring
const RING_INNER_R = 38   // screen pixels — inner radius (gap for compass)
const SUN_ARROW_R = 46    // radius at which the sun arrow sits
const MOON_R = 8          // moon icon radius

// Phase colors
const DAWN_COLOR = 'rgba(255, 183, 77, 0.7)'   // amber
const DAY_COLOR = 'rgba(255, 235, 59, 0.5)'     // yellow
const DUSK_COLOR = 'rgba(255, 152, 0, 0.7)'     // orange
const NIGHT_COLOR = 'rgba(30, 60, 114, 0.5)'    // dark blue
const SUN_COLOR = '#FFA000'
const MOON_COLOR = '#B0BEC5'

export interface CelestialData {
  sunAzimuth: number    // radians, clockwise from north
  sunAltitude: number   // radians
  moonPhase: number     // 0=new, 0.5=full
  dawnAngle: number     // ring angle for dawn (radians, clockwise from top)
  sunriseAngle: number
  sunsetAngle: number
  duskAngle: number
}

/**
 * Compute celestial data for a given date and location using suncalc.
 */
export function computeCelestialData(
  date: Date,
  lat: number,
  lon: number,
): CelestialData {
  const sunPos = SunCalc.getPosition(date, lat, lon)
  const times = SunCalc.getTimes(date, lat, lon)
  const moonIllum = SunCalc.getMoonIllumination(date)

  // Convert sun event times to ring angles (0 = top/midnight, clockwise)
  const timeToAngle = (t: Date): number => {
    const hours = t.getHours() + t.getMinutes() / 60
    return (hours / 24) * Math.PI * 2 - Math.PI / 2 // -PI/2 so 0h is at top
  }

  return {
    sunAzimuth: sunPos.azimuth + Math.PI, // suncalc returns south-based, convert to north-based
    sunAltitude: sunPos.altitude,
    moonPhase: moonIllum.phase,
    dawnAngle: timeToAngle(times.dawn),
    sunriseAngle: timeToAngle(times.sunrise),
    sunsetAngle: timeToAngle(times.sunset),
    duskAngle: timeToAngle(times.dusk),
  }
}

/**
 * Create the celestial dial as a Konva.Group to be added to the compass group.
 */
export function createCelestialDial(): Konva.Group {
  const group = new Konva.Group({ name: 'celestial-dial', listening: false })
  return group
}

/**
 * Update the celestial dial rendering with new data.
 */
export function updateCelestialDial(
  dialGroup: Konva.Group,
  data: CelestialData,
): void {
  dialGroup.destroyChildren()

  // Night arc: dusk → dawn (going through midnight)
  _drawArc(dialGroup, data.duskAngle, data.dawnAngle, NIGHT_COLOR)

  // Dawn arc: dawn → sunrise
  _drawArc(dialGroup, data.dawnAngle, data.sunriseAngle, DAWN_COLOR)

  // Day arc: sunrise → sunset
  _drawArc(dialGroup, data.sunriseAngle, data.sunsetAngle, DAY_COLOR)

  // Dusk arc: sunset → dusk
  _drawArc(dialGroup, data.sunsetAngle, data.duskAngle, DUSK_COLOR)

  // Sun direction arrow
  const sunX = Math.cos(data.sunAzimuth - Math.PI / 2) * SUN_ARROW_R
  const sunY = Math.sin(data.sunAzimuth - Math.PI / 2) * SUN_ARROW_R
  const sunDot = new Konva.Circle({
    x: sunX,
    y: sunY,
    radius: 5,
    fill: SUN_COLOR,
    listening: false,
  })
  dialGroup.add(sunDot)

  // Moon phase icon
  const moonAngle = data.sunAzimuth + Math.PI // opposite side from sun
  const moonX = Math.cos(moonAngle - Math.PI / 2) * SUN_ARROW_R
  const moonY = Math.sin(moonAngle - Math.PI / 2) * SUN_ARROW_R

  const moonShape = new Konva.Shape({
    x: moonX,
    y: moonY,
    sceneFunc: (ctx) => {
      _drawMoonPhase(ctx, data.moonPhase, MOON_R)
    },
    listening: false,
  })
  dialGroup.add(moonShape)
}

// ---------------------------------------------------------------------------
// Internal drawing helpers
// ---------------------------------------------------------------------------

function _drawArc(
  group: Konva.Group,
  startAngle: number,
  endAngle: number,
  color: string,
): void {
  const arc = new Konva.Arc({
    innerRadius: RING_INNER_R,
    outerRadius: RING_OUTER_R,
    angle: _normalizeAngleDiff(startAngle, endAngle) * (180 / Math.PI),
    rotation: startAngle * (180 / Math.PI),
    fill: color,
    listening: false,
  })
  group.add(arc)
}

function _normalizeAngleDiff(start: number, end: number): number {
  let diff = end - start
  while (diff < 0) diff += Math.PI * 2
  while (diff > Math.PI * 2) diff -= Math.PI * 2
  return diff
}

function _drawMoonPhase(
  ctx: Konva.Context,
  phase: number, // 0=new, 0.25=first quarter, 0.5=full, 0.75=last quarter
  r: number,
): void {
  // Draw a crescent moon using two arcs
  ctx.beginPath()
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false) // right half circle

  // Terminator curve — controlled by phase
  const illumination = phase < 0.5 ? phase * 2 : (1 - phase) * 2
  const curveRadius = r * (1 - illumination * 2)

  if (phase < 0.5) {
    // Waxing: terminator curves inward on the right
    ctx.arc(0, 0, Math.abs(curveRadius), Math.PI / 2, -Math.PI / 2, curveRadius > 0)
  } else {
    // Waning: terminator curves inward on the left
    ctx.arc(0, 0, Math.abs(curveRadius), Math.PI / 2, -Math.PI / 2, curveRadius <= 0)
  }

  ctx.closePath()
  ctx.fillStyle = MOON_COLOR
  ctx.fill()

  // Outer circle border
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(176, 190, 197, 0.5)'
  ctx.lineWidth = 0.5
  ctx.stroke()
}
