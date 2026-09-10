import type { CanvasPrintSnapshot, PrintPoint as Point } from '../../canvas/print'
import { contains, distance, edge, hits, type Segment } from './field-geometry'
import { FieldSpace, type FieldLabel } from './field-placement'

type Guide = CanvasPrintSnapshot['measurements'][number]
export interface FieldDimension {
  guide: Guide
  label: FieldLabel
  segments: Segment[]
  ticks: Segment[]
  cost: number
}

export function fieldDimensions(guides: readonly Guide[], point: (p: Point) => Point, space: FieldSpace, locale: string): FieldDimension[] {
  const guideLength = (g: Guide) => distance(g.start, g.end)
  const orders = [
    [...guides].sort((a, b) => a.start.y - b.start.y || a.start.x - b.start.x),
    [...guides].sort((a, b) => b.start.y - a.start.y || b.start.x - a.start.x),
    [...guides].sort((a, b) => guideLength(a) - guideLength(b)),
    [...guides].sort((a, b) => guideLength(b) - guideLength(a)),
  ]
  let best: FieldDimension[] = []
  for (const order of orders) {
    const trial = space.fork(), placed: FieldDimension[] = []
    for (const guide of order) {
      const a = point(guide.start), b = point(guide.end), length = distance(a, b)
      if (length < 1e-8) continue
      const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }, n = { x: -u.y, y: u.x }
      const measured = space.measure(`${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(guideLength(guide))} m`, 9, Infinity, true)
      const { width, height } = measured
      let chosen: FieldDimension | null = null
      for (const offset of [-2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -8, 8, -10, 10, -12, 12, -15, 15, -18, 18, -22, 22, -25, 25, -30, 30, -34, 34, -40, 40, -45, 45, -52, 52, -58, 58]) {
        const oa = { x: a.x + n.x * offset, y: a.y + n.y * offset }, ob = { x: b.x + n.x * offset, y: b.y + n.y * offset }
        const mid = { x: (oa.x + ob.x) / 2, y: (oa.y + ob.y) / 2 }
        for (const [dx, dy] of [[-width / 2 - 1.2, 0], [width / 2 + 1.2, 0], [0, -height / 2 - 1.2], [0, height / 2 + 1.2], [-width / 2 - 1.2, -5], [width / 2 + 1.2, 5], [0, -8], [0, 8], [-width / 2 - 2, -12], [width / 2 + 2, 12], [-width / 2 - 2, 12], [width / 2 + 2, -12], [-width / 2 - 1.2, -2], [width / 2 + 1.2, 2], [-width / 2 - 1.2, 2], [width / 2 + 1.2, -2]]) {
          const baseCost = Math.abs(offset) + Math.abs(dx!) + Math.abs(dy!)
          if (chosen && baseCost >= chosen.cost) continue
          const bounds = { x: mid.x + dx! - width / 2, y: mid.y + dy! - height / 2, width, height }
          if (!trial.clear(bounds)) continue
          const segments = [{ a, b: oa }, { a: oa, b: ob }, { a: b, b: ob }]
          const vx = (u.x + n.x) * .55, vy = (u.y + n.y) * .55
          const ticks = [oa, ob].map(p => ({ a: { x: p.x - vx, y: p.y - vy }, b: { x: p.x + vx, y: p.y + vy } }))
          if ([...segments, ...ticks].some(s => !contains(space.frame, s.a) || !contains(space.frame, s.b) || hits(s, bounds) || placed.some(d => hits(s, d.label.bounds)))) continue
          const end = edge(bounds, mid)
          if (distance(mid, end) > 2) segments.push({ a: mid, b: end })
          if (segments.some(s => placed.some(d => hits(s, d.label.bounds)))) continue
          const markHits = segments.reduce((sum, s) => sum + [...space.marks.values()].filter(r => hits(s, r)).length, 0)
          const cost = baseCost + markHits * 14 + trial.crossings(segments) * 8
          if (chosen && cost >= chosen.cost) continue
          chosen = { guide, segments, ticks, cost, label: { ...measured, bounds, route: [], target: '', ids: [], color: '#24211c' } }
        }
      }
      if (chosen) { placed.push(chosen); trial.reserve(chosen.label.bounds); trial.addSegments([...chosen.segments, ...chosen.ticks], true) }
    }
    if (placed.length > best.length || placed.length === best.length && placed.reduce((n, d) => n + d.cost, 0) < best.reduce((n, d) => n + d.cost, 0)) best = placed
  }
  for (const dimension of best) { space.reserve(dimension.label.bounds); space.addSegments([...dimension.segments, ...dimension.ticks], true) }
  return best
}
