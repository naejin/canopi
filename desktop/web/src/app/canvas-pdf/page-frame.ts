// app/canvas-pdf/page-frame.ts
//
// Owns the one angle of a PDF layout (spec §4.12, ADR 0015): North up is 0, As on screen is the view's bearing read at
// capture. The layout runs once per build on a turned copy of the print snapshot, so no layout module takes an angle and
// text stays level on paper. The frame turns about the plan origin; Print Areas and page offsets stay in plan metres,
// independent of the frame, and each build converts them, so switching Map orientation or reopening at a new bearing
// turns every area about its own centre, and the sheets of one split together about their split's centre (its pivot).

import type { CanvasPrintSnapshot, PrintBounds, PrintPoint, PrintZone } from '../../canvas/print'
import { outlineSegments } from './field-geometry'
import type { PdfInput, PdfSetup } from './types'

export interface PageFrame {
  /** Clockwise degrees in [0, 360); 0 is North up and the identity. */
  readonly angleDeg: number
  /** Plan metres to the page frame: turned by −angle about the plan origin. Linear, so it turns vectors too. */
  toFrame(point: PrintPoint): PrintPoint
  /** The page frame back to plan metres: turned by +angle. */
  fromFrame(point: PrintPoint): PrintPoint
}

const same = (point: PrintPoint) => point
const NORTH_UP: PageFrame = { angleDeg: 0, toFrame: same, fromFrame: same }

export function pageFrame(angleDeg: number): PageFrame {
  const angle = ((angleDeg % 360) + 360) % 360
  if (angle === 0) return NORTH_UP
  const radians = angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians)
  return {
    angleDeg: angle,
    toFrame: ({ x, y }) => ({ x: c * x + s * y, y: -s * x + c * y }),
    fromFrame: ({ x, y }) => ({ x: c * x - s * y, y: s * x + c * y }),
  }
}

/** The layout angle: the view's bearing under As on screen, else 0. */
export function layoutAngle(setup: Pick<PdfSetup, 'mapOrientation'>, input: Pick<PdfInput, 'viewBearingDeg'>): number {
  return setup.mapOrientation === 'as-on-screen' ? input.viewBearingDeg : 0
}

/**
 * A Print Area's rectangle on the page. The area is a box in plan metres, its sides along the page axes; it turns about
 * `pivot` (a plan point; absent, its own centre), its centre keeping its offset from the pivot along the page axes.
 */
export function areaToFrame(frame: PageFrame, area: PrintBounds, pivot?: PrintPoint): PrintBounds {
  if (!frame.angleDeg) return area
  const centre = centreOf(area)
  if (!pivot) return boxAbout(frame.toFrame(centre), area)
  const turned = frame.toFrame(pivot)
  return boxAbout({ x: turned.x + centre.x - pivot.x, y: turned.y + centre.y - pivot.y }, area)
}

/** A rectangle on the page as a Print Area turning about `pivot` (a plan point; absent, the rectangle's own centre). */
export function areaFromFrame(frame: PageFrame, rectangle: PrintBounds, pivot?: PrintPoint): PrintBounds {
  if (!frame.angleDeg) return rectangle
  const centre = centreOf(rectangle)
  if (!pivot) return boxAbout(frame.fromFrame(centre), rectangle)
  const turned = frame.toFrame(pivot)
  return boxAbout({ x: pivot.x + centre.x - turned.x, y: pivot.y + centre.y - turned.y }, rectangle)
}

/** Whether a plan point lies inside a Print Area as the page frames it. */
export function areaContains(frame: PageFrame, area: PrintBounds, point: PrintPoint, pivot?: PrintPoint): boolean {
  const r = areaToFrame(frame, area, pivot), p = frame.toFrame(point)
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

const centreOf = (box: PrintBounds): PrintPoint => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
const boxAbout = (centre: PrintPoint, { width, height }: PrintBounds): PrintBounds =>
  ({ x: centre.x - width / 2, y: centre.y - height / 2, width, height })

/** The snapshot in the page frame; North up returns the same snapshot. */
export function turnSnapshot(snapshot: CanvasPrintSnapshot, frame: PageFrame): CanvasPrintSnapshot {
  if (!frame.angleDeg) return snapshot
  const turn = frame.toFrame
  return {
    layers: snapshot.layers,
    plants: snapshot.plants.map(plant => ({ ...plant, position: turn(plant.position) })),
    zones: snapshot.zones.map(zone => turnZone(zone, frame)),
    annotations: snapshot.annotations.map(note => ({ ...note, position: turn(note.position), rotation: note.rotation - frame.angleDeg })),
    measurements: snapshot.measurements.map(guide => ({ ...guide, start: turn(guide.start), end: turn(guide.end) })),
  }
}

function turnZone(zone: PrintZone, frame: PageFrame): PrintZone {
  const path = turnPath(zone.path, frame.toFrame)
  const geometry: PrintZone['geometry'] = !zone.geometry ? undefined : zone.geometry.kind === 'ellipse'
    ? { ...zone.geometry, center: frame.toFrame(zone.geometry.center), rotation: zone.geometry.rotation - frame.angleDeg }
    : { ...zone.geometry, points: zone.geometry.points.map(frame.toFrame) }
  return { ...zone, path, bounds: turnedBounds(zone, geometry, path, frame), ...(geometry ? { geometry } : {}) }
}

function turnedBounds(zone: PrintZone, geometry: PrintZone['geometry'], path: string, frame: PageFrame): PrintBounds {
  if (geometry?.kind === 'ellipse') {
    const a = geometry.rotation * Math.PI / 180, { x: rx, y: ry } = geometry.radii
    const hx = Math.hypot(rx * Math.cos(a), ry * Math.sin(a)), hy = Math.hypot(rx * Math.sin(a), ry * Math.cos(a))
    return { x: geometry.center.x - hx, y: geometry.center.y - hy, width: 2 * hx, height: 2 * hy }
  }
  const points = geometry?.points.length ? geometry.points
    : outlineSegments(path, same).flatMap(segment => [segment.a, segment.b])
  const { x, y, width, height } = zone.bounds
  return boxOf(points.length ? points : [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }].map(frame.toFrame))
}

function boxOf(points: readonly PrintPoint[]): PrintBounds {
  const xs = points.map(p => p.x), ys = points.map(p => p.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/** Every coordinate pair of an M/L/H/V/C/Z print path, turned; the result is absolute M, L, C and Z. */
function turnPath(path: string, turn: (point: PrintPoint) => PrintPoint): string {
  const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) ?? []
  const out: string[] = []
  let i = 0, command = '', point: PrintPoint = { x: 0, y: 0 }, start = point
  const number = () => Number(tokens[i++])
  const read = (relative: boolean): PrintPoint => ({ x: number() + (relative ? point.x : 0), y: number() + (relative ? point.y : 0) })
  const emit = (letter: string, ...points: PrintPoint[]) => {
    out.push(`${letter}${points.map(p => { const t = turn(p); return `${t.x} ${t.y}` }).join(' ')}`)
  }
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i]!)) command = tokens[i++]!
    const relative = command === command.toLowerCase()
    switch (command.toUpperCase()) {
      case 'M': point = read(relative); start = point; emit('M', point); command = relative ? 'l' : 'L'; break
      case 'L': point = read(relative); emit('L', point); break
      case 'H': point = { ...point, x: number() + (relative ? point.x : 0) }; emit('L', point); break
      case 'V': point = { ...point, y: number() + (relative ? point.y : 0) }; emit('L', point); break
      case 'C': { const b = read(relative), c = read(relative), next = read(relative); emit('C', b, c, next); point = next; break }
      case 'Z': out.push('Z'); point = start; command = ''; break
      default: throw new Error('unsupported-print-path')
    }
  }
  return out.join(' ')
}
