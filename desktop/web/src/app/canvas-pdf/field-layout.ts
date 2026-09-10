import type { CanvasPrintSnapshot, PrintBounds, PrintPlant, PrintPoint } from '../../canvas/print'
import type { PdfDestination, PdfInput, PdfLegendEntry, PdfLink, PdfOperation, PdfPageReference } from './types'
import type { PdfTextEngine } from './text'
import { MM } from './print-style'
import { drawMark, identifyPlants, pathOp, rectPath, textOp } from './page-drawing'
import { nearestPlantSpacing } from '../../canvas/plant-spacing'
import { paperPlantRadius } from './plant-marks'
import { contains, clipSegment, distance, hits, inflate, outlineSegments, type Segment } from './field-geometry'
import { FieldSpace, separatedConnectors, type FieldLabel } from './field-placement'
import { plantingRows } from './field-rows'
import { fieldDimensions } from './field-dimensions'

export interface FieldReferences {
  species: ReadonlyMap<string, string>
  notes: ReadonlyMap<string, string>
  measurements: ReadonlyMap<string, string>
  plants: ReadonlyMap<string, string>
  measurementHomes?: ReadonlyMap<string, string>
}
export interface FieldNote {
  id: string
  reference: string
  text: string
  position: PrintPoint
  kind: 'annotation' | 'distance' | 'plants'
  plantIds?: readonly string[]
  location?: string
  continuation?: string
}
export interface FieldDrawing {
  pageReferences: PdfPageReference[]
  operations: PdfOperation[]
  links: PdfLink[]
  destinations: PdfDestination[]
  legend: PdfLegendEntry[]
  notes: FieldNote[]
  identifiedPlants: { ids: readonly string[]; reference: string; bounds: PrintBounds }[]
  annotationIds: string[]
  measurementIds: string[]
}
const INK = '#24211c', OCHRE = '#A06B1F'
const appearance = (p: PrintPlant) => JSON.stringify([p.canonicalName, p.symbol, p.color.toLowerCase()])
const paper = (r: PrintBounds): PrintBounds => ({ x: r.x * MM, y: r.y * MM, width: r.width * MM, height: r.height * MM })

/** Allocate once from the whole Design: cropping and locale never renumber a species. */
export function fieldReferences(input: PdfInput): FieldReferences {
  const codes = new Map(input.canvas.plants.map(p => [p.canonicalName, p.speciesCode ?? p.canonicalName]))
  const names = [...codes.keys()].sort((a, b) => codes.get(a)!.localeCompare(codes.get(b)!, 'en') || a.localeCompare(b, 'en'))
  const ordered = <T extends { id: string; position: PrintPoint }>(items: readonly T[], prefix: string) => new Map([...items]
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id))
    .map((p, i) => [p.id, `${prefix}${i + 1}`]))
  return { species: new Map(names.map((name, i) => [name, String(i + 1).padStart(2, '0')])),
    notes: ordered(input.canvas.annotations, 'N'), plants: ordered(input.canvas.plants, 'P'),
    measurements: ordered(input.canvas.measurements.map(g => ({ ...g, position: g.start })), 'M') }
}

export function visibleFieldCanvas(canvas: CanvasPrintSnapshot, ground: PrintBounds): CanvasPrintSnapshot {
  return { ...canvas, plants: canvas.plants.filter(p => contains(ground, p.position)),
    annotations: canvas.annotations.filter(n => contains(ground, n.position)),
    measurements: canvas.measurements.filter(g => hits({ a: g.start, b: g.end }, ground)) }
}

/** One pure physical layout feeds both the SVG preview and the encoder. */
export function drawField(input: PdfInput, frame: PrintBounds, ground: PrintBounds, scale: number, page: { id: string; width: number; height: number },
  text: PdfTextEngine, references: FieldReferences): FieldDrawing {
  const canvas = input.canvas, operations: PdfOperation[] = [], links: PdfLink[] = [], destinations: PdfDestination[] = []
  const point = (p: PrintPoint): PrintPoint => ({ x: (frame.x + (p.x - ground.x) * scale) / MM, y: (frame.y + (p.y - ground.y) * scale) / MM })
  const opacity = (name: string) => canvas.layers.find(l => l.name === name)?.opacity ?? 1
  const space = new FieldSpace({ x: 8, y: 8, width: page.width / MM - 16, height: page.height / MM - 16 }, text)
  space.reserve({ x: 8.3, y: 8.3, width: 12, height: 10 })
  const line = (s: Segment, color: string, width: number, alpha = 1) => operations.push({ ...pathOp(`M${s.a.x * MM} ${s.a.y * MM} L${s.b.x * MM} ${s.b.y * MM}`, color, null, width * MM), opacity: alpha })
  const labelText = (label: FieldLabel) => label.lines.forEach((l, i) => operations.push({ ...textOp(l, (label.bounds.x + label.inset) * MM,
    (label.bounds.y + label.baseline + i * label.leading) * MM, label.size), color: label.color }))
  const legend = identifyPlants(canvas.plants, input.commonNames, input.locale).map(entry => ({ ...entry, reference: references.species.get(entry.canonicalName)!,
    count: canvas.plants.filter(p => p.canonicalName === entry.canonicalName).length })).sort((a, b) => Number(a.reference) - Number(b.reference))
  operations.push({ kind: 'clip', bounds: frame })
  const zoneSegments: Segment[] = []
  for (const zone of canvas.zones) {
    if (!hits({ a: { x: zone.bounds.x, y: zone.bounds.y }, b: { x: zone.bounds.x + zone.bounds.width, y: zone.bounds.y + zone.bounds.height } }, ground)
      && !(zone.bounds.x <= ground.x + ground.width && zone.bounds.x + zone.bounds.width >= ground.x && zone.bounds.y <= ground.y + ground.height && zone.bounds.y + zone.bounds.height >= ground.y)) continue
    operations.push({ kind: 'path', d: zone.path, matrix: [scale, 0, 0, scale, frame.x - ground.x * scale, frame.y - ground.y * scale],
      fill: zone.fill, stroke: '#8b877f', width: .18 * MM / scale, opacity: opacity('zones') })
    zoneSegments.push(...outlineSegments(zone.path, point))
  }
  operations.push({ kind: 'unclip' })
  space.addSegments(zoneSegments)
  const points = canvas.plants.map(p => ({ plant: p, point: point(p.position), radius: Math.min(1, paperPlantRadius(canvas.plants, p, scale) / MM) }))
  for (const p of points) space.mark(p.plant.id, { x: p.point.x - p.radius, y: p.point.y - p.radius, width: 2 * p.radius, height: 2 * p.radius })
  const notes: FieldNote[] = canvas.annotations.map((n): FieldNote => ({ id: n.id, reference: references.notes.get(n.id)!, text: n.text, position: n.position, kind: 'annotation' }))
    .sort((a, b) => Number(a.reference.slice(1)) - Number(b.reference.slice(1)))
  for (const note of notes) { const p = point(note.position); space.mark(note.id, { x: p.x - .7, y: p.y - .7, width: 1.4, height: 1.4 }) }
  const identifiedPlants: FieldDrawing['identifiedPlants'] = []
  const deferredMeasurement = (guide: CanvasPrintSnapshot['measurements'][number]) => {
    const clipped = clipSegment({ a: guide.start, b: guide.end }, ground)!
    const position = { x: (clipped.a.x + clipped.b.x) / 2, y: (clipped.a.y + clipped.b.y) / 2 }
    const value = `${new Intl.NumberFormat(input.locale, { maximumFractionDigits: 2 }).format(distance(guide.start, guide.end))} m`
    const projected = { a: point(clipped.a), b: point(clipped.b) }
    line(projected, '#a29c91', .12, opacity('measurement-guides')); space.addSegments([projected])
    notes.push({ id: guide.id, reference: references.measurements.get(guide.id)!, text: value, position, kind: 'distance',
      continuation: references.measurementHomes?.get(guide.id) === page.id ? undefined : references.measurementHomes?.get(guide.id) })
  }
  const pageReferences: PdfPageReference[] = []
  const processedNotes = new Set<string>()
  {
    const grouped = new Set<string>()
    interface Target { plants: readonly PrintPlant[]; anchors: PrintPoint[]; spine?: Segment; segments?: Segment[] }
    const targets: Target[] = []
    const directions = zoneSegments.filter(s => distance(s.a, s.b) / scale * MM > 2).map(s => Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x))
    for (const run of plantingRows(canvas.plants, directions)) {
      const first = point(run[0]!.position), last = point(run[run.length - 1]!.position), length = distance(first, last)
      if (length < 5 || run.some(p => p.pinnedName)) continue
      const u = { x: (last.x - first.x) / length, y: (last.y - first.y) / length }
      const choices = [-1, 1].map(side => {
        const n = { x: -u.y * side, y: u.x * side }, a = { x: first.x + n.x * 1.55, y: first.y + n.y * 1.55 }, b = { x: last.x + n.x * 1.55, y: last.y + n.y * 1.55 }
        const spine = { a, b }
        const ticks = run.map(p => { const v = point(p.position), d = (v.x - first.x) * u.x + (v.y - first.y) * u.y
          return { a: { x: a.x + u.x * d, y: a.y + u.y * d }, b: v } })
        return { spine, ticks, cost: points.filter(p => hits(spine, space.marks.get(p.plant.id)!)).length * 10 + space.crossings([spine]) }
      }).filter(c => contains(space.frame, c.spine.a) && contains(space.frame, c.spine.b)).sort((a, b) => a.cost - b.cost)
      const chosen = choices[0]
      if (!chosen || chosen.cost >= 20) continue
      const segments = [chosen.spine, ...chosen.ticks]
      space.addSegments(segments)
      targets.push({ plants: run, anchors: [chosen.spine.a, chosen.spine.b, { x: (chosen.spine.a.x + chosen.spine.b.x) / 2, y: (chosen.spine.a.y + chosen.spine.b.y) / 2 }, ...chosen.ticks.map(t => t.a)], spine: chosen.spine, segments })
      run.forEach(p => grouped.add(p.id))
    }
    // Coincident placements remain a single physical anchor with an explicit count.
    const singles = new Map<string, PrintPlant[]>()
    for (const p of canvas.plants.filter(p => !grouped.has(p.id))) {
      const key = JSON.stringify([p.position.x, p.position.y])
      const group = singles.get(key) ?? []; group.push(p); singles.set(key, group)
    }
    for (const group of singles.values()) targets.push({ plants: group, anchors: [point(group[0]!.position)] })
    const complete = canvas.measurements.filter(g => contains(ground, g.start) && contains(ground, g.end))
    const dimensions = fieldDimensions(complete, point, space, input.locale)
    const dimensionIds = new Set(dimensions.map(d => d.guide.id))
    for (const d of dimensions) {
      d.segments.forEach((s, i) => line(s, i === 1 ? '#49453f' : '#a29c91', i === 1 ? .23 : .12, opacity('measurement-guides')))
      d.ticks.forEach(s => line(s, INK, .3, opacity('measurement-guides'))); labelText(d.label)
    }
    for (const guide of canvas.measurements.filter(g => !dimensionIds.has(g.id))) {
      deferredMeasurement(guide)
    }
    placeNotes()
    const owners = new Map<FieldLabel, Target>()
    const unresolved: Target[] = []
    targets.sort((a, b) => Number(!!a.spine) - Number(!!b.spine) || a.anchors[0]!.y - b.anchors[0]!.y || a.anchors[0]!.x - b.anchors[0]!.x)
    for (const target of targets) {
      const p = target.plants[0]!, reference = references.species.get(p.canonicalName)!, ids = target.plants.map(p => p.id)
      if (new Set(target.plants.map(appearance)).size > 1) {
        const counts = new Map<string, number>()
        for (const plant of target.plants) counts.set(plant.canonicalName, (counts.get(plant.canonicalName) ?? 0) + 1)
        const value = [...counts].sort((a, b) => Number(references.species.get(a[0])) - Number(references.species.get(b[0])))
          .map(([name, count]) => `${references.species.get(name)} · ${input.commonNames[name]?.trim() || name} ×${count}`).join('\n')
        notes.push({ id: p.id, reference: references.plants.get(p.id)!, text: value, position: p.position, kind: 'plants', plantIds: ids })
        continue
      }
      // Below the printed dot diameter, separate positions cannot be read.
      // Avoid searching hundreds of leader routes through an inseparable cluster.
      if (!target.spine && !p.pinnedName && nearestPlantSpacing(canvas.plants, p.position) * scale < .7 * MM) { unresolved.push(target); continue }
      const value = reference + (p.pinnedName ? ` ${input.commonNames[p.canonicalName]?.trim() || p.canonicalName}` : '') + (ids.length > 1 ? ` ×${ids.length}` : '')
      const measured = space.measure(value, 9.5, p.pinnedName ? 29 : Infinity)
      const position = point(p.position)
      let left = 30, right = 30
      for (const other of points) { if (ids.includes(other.plant.id) || Math.abs(other.point.y - position.y) > 3.5) continue
        if (other.point.x < position.x) left = Math.min(left, position.x - other.point.x); else right = Math.min(right, other.point.x - position.x) }
      const label = space.place(measured, target.anchors, ids, `${page.id}:key:${reference}`, { preferred: left >= right ? -1 : 1 })
      if (!label) { unresolved.push(target); continue }
      space.admit(label); owners.set(label, target)
      for (const segment of target.segments ?? []) line(segment, '#656058', .19, opacity('plants'))
    }
    // Density is solved by enlarging coverage on explicit field sheets, not by
    // turning every failed label into another coordinate entry in the key.
    for (const target of unresolved) {
      const p = target.plants[0]!, anchor = point(p.position)
      identifiedPlants.push({ ids: target.plants.map(p => p.id), reference: references.species.get(p.canonicalName)!,
        bounds: paper({ ...anchor, width: 0, height: 0 }) })
    }
    placeNotes()
    const named = new Set(canvas.plants.filter(p => p.pinnedName).map(p => p.canonicalName))
    for (const [old, target] of [...owners].sort((a, b) => Number(!!b[1].spine) - Number(!!a[1].spine))) {
      const p = target.plants[0]!
      if (named.has(p.canonicalName)) continue
      const name = input.commonNames[p.canonicalName]?.trim() || p.canonicalName
      const value = `${references.species.get(p.canonicalName)} ${name}` + (target.plants.length > 1 ? `\n×${target.plants.length}` : '')
      const measured = space.measure(value, 9.5, 29)
      // Long authored names remain complete in the key instead of occupying the map.
      if (measured.lines.length > 5) continue
      const next = space.place(measured, target.anchors.slice(0, 3), old.ids, old.target, { ignored: old, name: true })
      if (!next || space.crossings(next.route, old)) continue
      space.replace(old, next); owners.delete(old); owners.set(next, target); named.add(p.canonicalName)
    }
    for (const [primary, target] of owners) {
      if (!target.spine) continue
      const length = distance(target.spine.a, target.spine.b)
      if (length < 65) continue
      const measured = space.measure(references.species.get(target.plants[0]!.canonicalName)!)
      for (let k = 0; k <= Math.ceil(length / 65); k++) {
        const t = k / Math.ceil(length / 65), anchor = { x: target.spine.a.x + (target.spine.b.x - target.spine.a.x) * t, y: target.spine.a.y + (target.spine.b.y - target.spine.a.y) * t }
        if (distance(anchor, primary.route[0]!.a) < 25) continue
        const label = space.place(measured, [anchor], [], primary.target, { near: true })
        if (label && space.crossings(label.route) <= 1) { label.repeated = true; space.admit(label) }
      }
    }
    for (const [label, target] of owners) identifiedPlants.push({ ids: label.ids, reference: references.species.get(target.plants[0]!.canonicalName)!, bounds: paper(label.bounds) })
  }

  function placeNotes(): void {
    for (const note of notes) {
      if (processedNotes.has(note.id)) continue
      processedNotes.add(note.id)
      const anchor = point(note.position)
      const isDistance = note.kind === 'annotation' && /^\(?\s*\d+(?:[,.]\d+)?\s*(?:cm|m)\s*\)?$/u.test(note.text.trim())
      const value = note.reference + (isDistance ? ` · ${note.text}` : '')
      const reservedValue = value + (note.continuation ? '      000' : '')
      const label = space.place(space.measure(reservedValue, isDistance ? 9.5 : 8), [anchor], [note.id, ...note.plantIds ?? []], `${page.id}:note:${note.reference}`, { color: OCHRE, boxed: !isDistance, note: true })
      if (label) {
        if (note.continuation) {
          label.lines = [text.line(value, label.size)]
          pageReferences.push({ target: note.continuation, x: (label.bounds.x + label.inset) * MM + label.lines[0]!.width + MM,
            y: (label.bounds.y + label.baseline) * MM, size: label.size })
          links.push({ bounds: paper(label.bounds), target: `page:${note.continuation}` })
          label.target = ''
        }
        space.admit(label)
        if (note.plantIds) identifiedPlants.push({ ids: note.plantIds, reference: note.reference, bounds: paper(label.bounds) })
      } else {
        const number = new Intl.NumberFormat(input.locale, { maximumFractionDigits: 2 })
        note.location = `x ${number.format(note.position.x)} m · y ${number.format(note.position.y)} m`
        if (note.plantIds) identifiedPlants.push({ ids: note.plantIds, reference: note.reference, bounds: paper({ ...anchor, width: 0, height: 0 }) })
      }
      operations.push(pathOp(rectPath(paper({ x: anchor.x - .55, y: anchor.y - .55, width: 1.1, height: 1.1 })), OCHRE, null, .23 * MM))
      destinations.push({ id: `${page.id}:anchor:${note.reference}`, bounds: paper(inflate({ ...anchor, width: 0, height: 0 }, 12)) })
    }
  }
  for (const { segment, label } of separatedConnectors(space.labels)) line(segment, label.color === OCHRE ? '#8a6b3b' : '#625d55', label.ids.length > 1 ? .23 : .17)
  for (const label of space.labels) {
    if (label.boxed) operations.push(pathOp(rectPath(paper(label.bounds)), label.color, null, .2 * MM))
    labelText(label)
    if (label.target) links.push({ bounds: paper(label.bounds), target: label.target })
  }
  operations.push({ kind: 'clip', bounds: frame })
  for (const p of points) drawMark(p.plant, p.point.x * MM, p.point.y * MM, p.radius * MM, opacity('plants'), operations)
  operations.push({ kind: 'unclip' })
  for (const entry of legend) {
    const locations = points.filter(p => p.plant.canonicalName === entry.canonicalName).map(p => p.point)
    const x = Math.min(...locations.map(p => p.x)), y = Math.min(...locations.map(p => p.y))
    destinations.push({ id: `${page.id}:species:${entry.reference}`, bounds: paper(inflate({ x, y, width: Math.max(...locations.map(p => p.x)) - x, height: Math.max(...locations.map(p => p.y)) - y }, 10)) })
  }
  notes.sort((a, b) => a.kind.localeCompare(b.kind, 'en') || Number(a.reference.slice(1)) - Number(b.reference.slice(1)))
  return { pageReferences, operations, links, destinations, legend, notes, identifiedPlants, annotationIds: canvas.annotations.map(n => n.id), measurementIds: canvas.measurements.map(g => g.id) }
}
