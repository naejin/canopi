import type { PrintBounds as Bounds, PrintPoint as Point } from '../../canvas/print'
import type { PdfTextEngine, TextLine } from './text'
import { MM } from './print-style'
import { PaperIndex, contains, crossing, distance, edge, fits, hits, inflate, overlaps, segmentBounds, type Segment } from './field-geometry'

export interface FieldConnector {
  route: Segment[]
  color: string
  width: number
  group?: string
  rail?: boolean
}

export interface FieldLabel {
  bounds: Bounds
  lines: readonly TextLine[]
  size: number
  leading: number
  baseline: number
  inset: number
  color: string
  route: Segment[]
  target: string
  ids: readonly string[]
  repeated?: boolean
  boxed?: boolean
}
export interface FieldMeasure { lines: readonly TextLine[]; width: number; height: number; size: number; leading: number; baseline: number; inset: number }

/** All geometry inside this module is in physical millimetres. */
export class FieldSpace {
  readonly labels: FieldLabel[] = []
  readonly marks = new Map<string, Bounds>()
  private markerBounds = new Set<Bounds>()
  readonly segments: Segment[] = []
  private rectangles = new PaperIndex<Bounds>()
  private paths = new PaperIndex<Segment>()
  private crossingPaths = new Set<Segment>()
  constructor(readonly frame: Bounds, readonly text: PdfTextEngine) {}

  fork(): FieldSpace {
    const copy = new FieldSpace(this.frame, this.text)
    for (const r of this.rectangles.query(this.frame)) copy.reserve(r)
    for (const [id, r] of this.marks) { copy.marks.set(id, r); copy.markerBounds.add(r) }
    for (const s of this.segments) copy.addSegments([s], this.crossingPaths.has(s))
    return copy
  }

  reserve(bounds: Bounds): void { this.rectangles.add(bounds, bounds) }
  release(bounds: Bounds): void { this.rectangles.remove(bounds) }
  mark(id: string, bounds: Bounds): void { this.marks.set(id, bounds); this.markerBounds.add(bounds); this.reserve(bounds) }
  addSegments(segments: readonly Segment[], crossingObstacle = false): void {
    for (const s of segments) { this.segments.push(s); this.paths.add(s, inflate(segmentBounds(s), .1)); if (crossingObstacle) this.crossingPaths.add(s) }
  }
  measure(value: string, size = 9.5, width = Infinity, strong = false): FieldMeasure {
    const lines = Number.isFinite(width) ? this.text.wrap(value, size, width * MM, strong) : [this.text.line(value, size, strong)]
    const leading = size * 1.1 / MM
    const left = Math.min(0, ...lines.map(l => (l.ink?.x ?? 0) / MM))
    const top = Math.min(-size * .7 / MM, ...lines.map((l, i) => (l.ink?.y ?? 0) / MM + i * leading))
    const bottom = Math.max(0, ...lines.map((l, i) => ((l.ink?.y ?? 0) + (l.ink?.height ?? 0)) / MM + i * leading))
    return { lines, width: Math.max(0, ...lines.map(l => Math.max(l.width, (l.ink?.x ?? 0) + (l.ink?.width ?? 0)))) / MM - left + .8,
      height: bottom - top + .4, size, leading, baseline: .2 - top, inset: .4 - left }
  }
  clear(bounds: Bounds, ignored?: FieldLabel): boolean {
    if (!fits(this.frame, inflate(bounds, .2))) return false
    if (this.rectangles.query(bounds).some(b => b !== ignored?.bounds && overlaps(bounds, b))) return false
    return !this.paths.query(bounds).some(s => !ignored?.route.includes(s) && hits(s, inflate(bounds, .2)))
  }
  pathClear(route: readonly Segment[], ids: readonly string[], ignored?: FieldLabel): boolean {
    const exempt = new Set(ids.map(id => this.marks.get(id)))
    for (const s of route) {
      if (!contains(this.frame, s.a) || !contains(this.frame, s.b)) return false
      if (this.rectangles.query(segmentBounds(s)).some(r => r !== ignored?.bounds && !exempt.has(r)
        && !(this.markerBounds.has(r) && contains(inflate(r, .1), route[0]!.a)) && hits(s, inflate(r, .1)))) return false
    }
    return true
  }
  /** Row brackets score marker crossings separately, but may never cross printed text. */
  inkClear(route: readonly Segment[]): boolean { return this.pathClear(route, [...this.marks.keys()]) }
  crossings(route: readonly Segment[], ignored?: FieldLabel): number {
    return route.reduce((n, s) => n + this.paths.query(segmentBounds(s)).filter(p => this.crossingPaths.has(p) && !ignored?.route.includes(p) && crossing(s, p)).length, 0)
  }
  place(measured: FieldMeasure, anchors: readonly Point[], ids: readonly string[], target: string,
    options: { color?: string; boxed?: boolean; near?: boolean; name?: boolean; note?: boolean; ignored?: FieldLabel; preferred?: number; axis?: 'x' | 'y'; outside?: Bounds } = {}): FieldLabel | null {
    const { width, height } = measured
    let best: FieldLabel | null = null, score = Infinity
    const extent = options.axis === 'y' ? height : width
    const offsets = options.name ? [2, 4, 7, 10, 14].flatMap(gap => [-extent / 2 - gap, extent / 2 + gap]) : options.near ? [-4, 4, -6, 6, -8, 8, -11, 11] : [-4, 4, -5, 5, -6, 6, -8, 8, -10, 10, -13, 13, -16, 16, -20, 20, -24, 24, -28, 28, -34, 34, -40, 40]
    const vertical = options.name ? [0, -4, 4, -8, 8, -12, 12] : options.near ? [0, -2, 2, -4, 4, -7, 7] : options.note ? [0, -4, 4, -8, 8, -12, 12, -16, 16, -20, 20, -25, 25, -30, 30]
      : [0, -.75, .75, -1.5, 1.5, -2.25, 2.25, -3, 3, -4, 4, -5, 5, -7.5, 7.5, -12, 12, -18, 18]
    for (const anchor of anchors) for (const dx of offsets) for (const dy of vertical) {
      const baseCost = Math.abs(dx) + Math.abs(dy) * 3 + (options.preferred && Math.sign(dx) !== options.preferred ? 6 : 0)
      if (baseCost >= score) continue
      const bounds = { x: anchor.x + (options.axis === 'y' ? dy : dx) - width / 2, y: anchor.y + (options.axis === 'y' ? dx : dy) - height / 2, width, height }
      if (options.outside && overlaps(bounds, options.outside)) continue
      if (!this.clear(bounds, options.ignored)) continue
      const end = edge(bounds, anchor)
      const routes: Segment[][] = [[{ a: anchor, b: end }]]
      const straightClear = this.pathClear(routes[0]!, ids, options.ignored)
      if (!straightClear || this.crossings(routes[0]!, options.ignored)) {
        for (const [x, y] of [[0, -2], [0, 2], [0, -3], [0, 3], [0, -4], [0, 4], [-2, 0], [2, 0], [-3, 0], [3, 0]]) {
          const elbow = { x: anchor.x + (options.axis === 'y' ? y! : x!), y: anchor.y + (options.axis === 'y' ? x! : y!) }
          routes.push([{ a: anchor, b: elbow }, { a: elbow, b: end }])
        }
      }
      for (const route of routes) {
        const cost = baseCost + route.reduce((n, s) => n + distance(s.a, s.b), 0) + (route.length > 1 ? 2 : 0)
        if (cost >= score || !this.pathClear(route, ids, options.ignored)) continue
        const total = cost + this.crossings(route, options.ignored) * 25
        if (total >= score) continue
        score = total
        best = { ...measured, bounds, route, ids, target, color: options.color ?? '#24211c', boxed: options.boxed }
      }
    }
    return best
  }
  admit(label: FieldLabel): void { this.labels.push(label); this.reserve(label.bounds); this.addSegments(label.route, true) }
  replace(previous: FieldLabel, next: FieldLabel): void {
    this.release(previous.bounds)
    for (const s of previous.route) { this.paths.remove(s); this.crossingPaths.delete(s); const i = this.segments.indexOf(s); if (i >= 0) this.segments.splice(i, 1) }
    this.labels[this.labels.indexOf(previous)] = next
    this.reserve(next.bounds); this.addSegments(next.route, true)
  }
}

/** Gaps belong to the underpassing connector; no white eraser hides artwork. */
export function separatedConnectors<T extends { route: readonly Segment[]; group?: string; rail?: boolean }>(labels: readonly T[]): { segment: Segment; label: T }[] {
  const pool = labels.flatMap(label => label.route.map(segment => ({ segment, label })))
  const index = new PaperIndex<typeof pool[number]>(), gaps = new Map<Segment, [number, number][]>()
  const length = (label: T) => label.route.reduce((n, s) => n + distance(s.a, s.b), 0)
  for (const item of pool) {
    for (const other of index.query(segmentBounds(item.segment))) {
      if (item.label === other.label || item.label.group && item.label.group === other.label.group) continue
      const cross = crossing(item.segment, other.segment)
      if (!cross) continue
      const under = !!item.label.rail !== !!other.label.rail ? item.label.rail ? item : other
        : length(item.label) >= length(other.label) ? item : other
      const t = under === item ? cross.t : cross.u, delta = .45 / distance(under.segment.a, under.segment.b)
      if (t < delta || t > 1 - delta) continue
      const intervals = gaps.get(under.segment) ?? []; intervals.push([t - delta, t + delta]); gaps.set(under.segment, intervals)
    }
    index.add(item, segmentBounds(item.segment))
  }
  return pool.flatMap(({ segment: s, label }) => {
    const intervals = (gaps.get(s) ?? []).sort((a, b) => a[0] - b[0])
    const at = (t: number): Point => ({ x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t })
    let from = 0
    const result: { segment: Segment; label: T }[] = []
    for (const [low, high] of [...intervals, [1, 1]]) {
      if (low! > from) result.push({ segment: { a: at(from), b: at(low!) }, label })
      from = Math.max(from, high!)
    }
    return result
  })
}
