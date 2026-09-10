import type { PrintBounds, PrintPlant, PrintPoint } from '../../canvas/print'
import { FieldSpace, type FieldConnector, type FieldLabel } from './field-placement'
import { orthogonalRoute } from './field-routing'
import type { Segment } from './field-geometry'

export interface FieldBracket {
  ids: readonly string[]
  reference: string
  labels: readonly FieldLabel[]
  connectors: readonly FieldConnector[]
  junctions: readonly PrintPoint[]
  color: string
}
interface PlantPosition { plant: PrintPlant; point: PrintPoint }

/** Select, route and admit complete appearance groups; failed groups leave no ink or obstacles. All units are mm. */
export function fieldBrackets(plants: readonly PlantPosition[], frame: PrintBounds, space: FieldSpace,
  references: ReadonlyMap<string, string>, pageId: string): FieldBracket[] {
  const horizontal = frame.width > frame.height, major = (p: PrintPoint) => horizontal ? p.x : p.y
  const minor = (p: PrintPoint) => horizontal ? p.y : p.x
  const point = (along: number, across: number): PrintPoint => horizontal ? { x: along, y: across } : { x: across, y: along }
  const low = minor(frame), high = low + (horizontal ? frame.height : frame.width)
  const shallow = Math.max(frame.width / frame.height, frame.height / frame.width) >= 4
  const minimum = Math.min(...plants.map(p => minor(p.point))), maximum = Math.max(...plants.map(p => minor(p.point)))
  const positions = new Map<string, number>()
  for (const item of plants) { const key = JSON.stringify(item.point); positions.set(key, (positions.get(key) ?? 0) + 1) }
  const appearances = new Map<string, PlantPosition[]>()
  for (const item of plants) {
    if (item.plant.pinnedName || positions.get(JSON.stringify(item.point))! > 1) continue
    const p = item.plant, side = minor(item.point) < (low + high) / 2 ? -1 : 1
    const key = JSON.stringify([p.canonicalName, p.symbol, p.color.toLowerCase(), shallow ? side : 0])
    const group = appearances.get(key) ?? []; group.push(item); appearances.set(key, group)
  }
  const candidates: PlantPosition[][] = []
  for (const items of appearances.values()) {
    if (shallow) { candidates.push(items); continue }
    let group: PlantPosition[] = []
    for (const item of [...items].sort((a, b) => minor(a.point) - minor(b.point))) {
      if (group.length && (minor(item.point) - minor(group[0]!.point) > 18 || minor(item.point) - minor(group[group.length - 1]!.point) > 6)) {
        candidates.push(group); group = []
      }
      group.push(item)
    }
    candidates.push(group)
  }
  candidates.sort((a, b) => b.length - a.length || a[0]!.plant.id.localeCompare(b[0]!.plant.id, 'en'))
  const result: FieldBracket[] = [], ports = new Map<number, number[]>(), lanes = new Map<number, number>()
  // One pathological field cannot monopolize the print worker with route searches.
  const budget = { remaining: 240000 }
  for (const group of candidates.slice(0, 36)) {
    if (group.length < 4 || budget.remaining <= 0) continue
    const middle = group.reduce((sum, p) => sum + minor(p.point), 0) / group.length
    const side = middle < (shallow ? low + high : minimum + maximum) / 2 ? -1 : 1
    if (!shallow && (side < 0 ? middle > minimum + (maximum - minimum) * .4 : middle < maximum - (maximum - minimum) * .4)) continue
    const start = Math.min(...group.map(p => major(p.point))), end = Math.max(...group.map(p => major(p.point)))
    if (end - start < 25) continue
    const firstLane = lanes.get(side) ?? 0
    for (let lane = firstLane; lane < (shallow ? 8 : 6); lane++) {
      const across = (side < 0 ? low : high) + side * (6 + lane * 7)
      const reference = references.get(group[0]!.plant.canonicalName)!, measured = space.measure(reference, 9.5, Infinity, true)
      const bounds = (along: number, last: boolean): PrintBounds => horizontal
        ? { x: along + (last ? .9 : -measured.width - .9), y: across - measured.height / 2, width: measured.width, height: measured.height }
        : { x: across - measured.width / 2, y: along + (last ? 1.3 : -measured.height - 1.3), width: measured.width, height: measured.height }
      const occupied = [...ports.get(side) ?? []], exits: { item: PlantPosition; along: number }[] = []
      for (const item of [...group].sort((a, b) => major(a.point) - major(b.point))) {
        const along = [0, -.9, .9, -1.8, 1.8, -2.7, 2.7].map(d => major(item.point) + d)
          .find(v => occupied.every(p => Math.abs(p - v) >= .75))
        if (along === undefined) break
        occupied.push(along); exits.push({ item, along })
      }
      if (exits.length !== group.length) continue
      const first = shallow ? major(frame) : Math.min(start, ...exits.map(p => p.along))
      const last = shallow ? major(frame) + (horizontal ? frame.width : frame.height) : Math.max(end, ...exits.map(p => p.along))
      const a = bounds(first, false), b = bounds(last, true)
      if (!space.clear(a) || !space.clear(b)) continue
      const copy = space.fork(); copy.reserve(a); copy.reserve(b)
      const rail = { a: point(first, across), b: point(last, across) }
      const ids = group.map(p => p.plant.id)
      if (!copy.pathClear([rail], ids)) continue
      const routes: Segment[][] = [], junctions: PrintPoint[] = []
      for (const { item, along } of exits) {
        // Approach the rail through a distinct port. The last segment cannot run along the rail.
        const exit = point(along, across - side), finish = point(along, across)
        const route = orthogonalRoute(copy, item.point, exit, [item.plant.id], budget)
        if (!route || !copy.pathClear([{ a: exit, b: finish }], [item.plant.id])) break
        routes.push([...route, { a: exit, b: finish }]); junctions.push(finish)
      }
      if (routes.length !== group.length) continue
      const color = connectorColor(group[0]!.plant.color), groupId = `${pageId}:bracket:${result.length}`, target = `${pageId}:key:${reference}`
      const labels: FieldLabel[] = [a, b].map((bounds, i) => ({ ...measured, bounds, route: [], ids: i ? [] : ids, target, color: '#24211c', repeated: !!i }))
      const connectors: FieldConnector[] = [{ route: [rail], color, width: .23, rail: true, group: groupId },
        ...routes.map(route => ({ route, color, width: .14, group: groupId }))]
      for (const label of labels) space.admit(label)
      for (const connector of connectors) space.addSegments(connector.route, true)
      result.push({ ids, reference, labels, connectors, junctions, color })
      ports.set(side, occupied); lanes.set(side, lane + 1)
      break
    }
  }
  return result
}

/** Pale authored marks stay unchanged; derived connector ink still needs contrast on paper. */
function connectorColor(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return '#625d55'
  const channels = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255)
  const linear = channels.map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
  const luminance = linear[0]! * .2126 + linear[1]! * .7152 + linear[2]! * .0722
  if (luminance <= .25) return color
  return '#' + linear.map(c => {
    const v = c * .25 / luminance
    return Math.round(255 * (v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055)).toString(16).padStart(2, '0')
  }).join('')
}
