import type { PrintBounds as Bounds, PrintPoint as Point } from '../../canvas/print'

export interface Segment { a: Point; b: Point }
export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)
export const inflate = (r: Bounds, d: number): Bounds => ({ x: r.x - d, y: r.y - d, width: r.width + 2 * d, height: r.height + 2 * d })
export const overlaps = (a: Bounds, b: Bounds) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
export const contains = (r: Bounds, p: Point) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
export const fits = (frame: Bounds, r: Bounds) => contains(frame, r) && contains(frame, { x: r.x + r.width, y: r.y + r.height })
export const edge = (r: Bounds, p: Point): Point => ({ x: Math.max(r.x, Math.min(p.x, r.x + r.width)), y: Math.max(r.y, Math.min(p.y, r.y + r.height)) })
export const segmentBounds = (s: Segment): Bounds => ({ x: Math.min(s.a.x, s.b.x), y: Math.min(s.a.y, s.b.y), width: Math.abs(s.b.x - s.a.x), height: Math.abs(s.b.y - s.a.y) })

export function hits(s: Segment, r: Bounds): boolean {
  return clipSegment(s, r) !== null
}

export function clipSegment(s: Segment, r: Bounds): Segment | null {
  let low = 0, high = 1
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y
  for (const [p, q] of [[-dx, s.a.x - r.x], [dx, r.x + r.width - s.a.x], [-dy, s.a.y - r.y], [dy, r.y + r.height - s.a.y]]) {
    if (Math.abs(p!) < 1e-9) { if (q! < 0) return null }
    else if (p! < 0) low = Math.max(low, q! / p!)
    else high = Math.min(high, q! / p!)
    if (low > high) return null
  }
  return { a: { x: s.a.x + dx * low, y: s.a.y + dy * low }, b: { x: s.a.x + dx * high, y: s.a.y + dy * high } }
}

export function crossing(a: Segment, b: Segment): { t: number; u: number } | null {
  const rx = a.b.x - a.a.x, ry = a.b.y - a.a.y, sx = b.b.x - b.a.x, sy = b.b.y - b.a.y
  const dx = b.a.x - a.a.x, dy = b.a.y - a.a.y, denominator = rx * sy - ry * sx
  if (Math.abs(denominator) < 1e-9) return null
  const t = (dx * sy - dy * sx) / denominator, u = (dx * ry - dy * rx) / denominator
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6 ? { t, u } : null
}

/** Paper-space buckets bound candidate queries without rasterizing the artwork. */
export class PaperIndex<T> {
  private cells = new Map<string, Set<T>>()
  private bounds = new Map<T, Bounds>()
  private large = new Set<T>()
  constructor(private cellSize = 12) {}
  private keys(r: Bounds): string[] | null {
    const x0 = Math.floor(r.x / this.cellSize), x1 = Math.floor((r.x + r.width) / this.cellSize)
    const y0 = Math.floor(r.y / this.cellSize), y1 = Math.floor((r.y + r.height) / this.cellSize)
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256) return null
    const keys: string[] = []
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(`${x}:${y}`)
    return keys
  }
  add(item: T, bounds: Bounds): void {
    this.remove(item); this.bounds.set(item, bounds)
    const keys = this.keys(bounds)
    if (!keys) { this.large.add(item); return }
    for (const key of keys) {
      let cell = this.cells.get(key)
      if (!cell) this.cells.set(key, cell = new Set())
      cell.add(item)
    }
  }
  remove(item: T): void {
    const bounds = this.bounds.get(item)
    if (!bounds) return
    for (const key of this.keys(bounds) ?? []) this.cells.get(key)?.delete(item)
    this.large.delete(item); this.bounds.delete(item)
  }
  query(bounds: Bounds): T[] {
    const keys = this.keys(bounds)
    if (!keys) return [...this.bounds.keys()]
    const found = new Set(this.large)
    for (const key of keys) for (const item of this.cells.get(key) ?? []) found.add(item)
    return [...found]
  }
}

/** Flatten the renderer-neutral M/L/H/V/C/Z paths emitted by print capture. */
export function outlineSegments(path: string, project: (p: Point) => Point): Segment[] {
  const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) ?? []
  const result: Segment[] = []
  let i = 0, command = '', point: Point = { x: 0, y: 0 }, start = point
  const number = () => Number(tokens[i++])
  const readPoint = (relative: boolean): Point => ({ x: number() + (relative ? point.x : 0), y: number() + (relative ? point.y : 0) })
  const line = (a: Point, b: Point) => { if (distance(a, b) > 1e-8) result.push({ a, b }) }
  const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const curve = (a: Point, b: Point, c: Point, d: Point, depth = 0): void => {
    const chord = distance(a, d)
    if (depth >= 12 || distance(a, b) + distance(b, c) + distance(c, d) - chord < .02) { line(a, d); return }
    const ab = middle(a, b), bc = middle(b, c), cd = middle(c, d), abc = middle(ab, bc), bcd = middle(bc, cd), m = middle(abc, bcd)
    curve(a, ab, abc, m, depth + 1); curve(m, bcd, cd, d, depth + 1)
  }
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i]!)) command = tokens[i++]!
    const relative = command === command.toLowerCase()
    switch (command.toUpperCase()) {
      case 'M': point = readPoint(relative); start = point; command = relative ? 'l' : 'L'; break
      case 'L': { const next = readPoint(relative); line(project(point), project(next)); point = next; break }
      case 'H': { const next = { ...point, x: number() + (relative ? point.x : 0) }; line(project(point), project(next)); point = next; break }
      case 'V': { const next = { ...point, y: number() + (relative ? point.y : 0) }; line(project(point), project(next)); point = next; break }
      case 'C': { const b = readPoint(relative), c = readPoint(relative), next = readPoint(relative); curve(project(point), project(b), project(c), project(next)); point = next; break }
      case 'Z': line(project(point), project(start)); point = start; command = ''; break
      default: throw new Error('unsupported-print-path')
    }
  }
  return result
}
