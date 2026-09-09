// THROWAWAY: evaluate dense-canvas hierarchy, never import into a production renderer.
import type { CanvasPrintSnapshot, PrintPlant, PrintPoint } from '../../../canvas/print'

export type Variant = 'current' | 'adaptive' | 'lens' | 'strip'
export interface View { x: number; y: number; scale: number }
export interface Palette { paper: string; ink: string; muted: string; accent: string; border: string }
export interface Model {
  source: CanvasPrintSnapshot
  nearest: number[]
  names: Map<string, string>
  paths: Map<string, Path2D>
}
export interface ReadingState {
  variant: Variant
  pointer: PrintPoint | null
  selectedId: string | null
  species: string
  stripX: number | null
}
export interface ReadingStats { visible: number; fullSymbols: number; positionMarks: number; annotationLabels: number; measurementLabels: number }

export function createModel(source: CanvasPrintSnapshot, names: Map<string, string>): Model {
  const nearest = source.plants.map((plant, i) => {
    let squared = Infinity
    source.plants.forEach((other, j) => {
      if (i !== j) squared = Math.min(squared, (plant.position.x - other.position.x) ** 2 + (plant.position.y - other.position.y) ** 2)
    })
    return Math.sqrt(squared)
  })
  const paths = new Map<string, Path2D>()
  for (const plant of source.plants) for (const mark of plant.mark) if (!paths.has(mark.d)) paths.set(mark.d, new Path2D(mark.d))
  for (const zone of source.zones) paths.set(zone.path, new Path2D(zone.path))
  return { source, nearest, names, paths }
}

export function screen(point: PrintPoint, view: View): PrintPoint {
  return { x: view.x + point.x * view.scale, y: view.y + point.y * view.scale }
}

export function world(point: PrintPoint, view: View): PrintPoint {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale }
}

export function nearby(model: Model, point: PrintPoint, count = 7): PrintPlant[] {
  return [...model.source.plants].sort((a, b) => distance(a.position, point) - distance(b.position, point)).slice(0, count)
}

function distance(a: PrintPoint, b: PrintPoint): number { return Math.hypot(a.x - b.x, a.y - b.y) }

export function drawReading(
  ctx: CanvasRenderingContext2D, model: Model, view: View, width: number, height: number,
  state: ReadingState, palette: Palette, detail = false,
): ReadingStats {
  const stats: ReadingStats = { visible: 0, fullSymbols: 0, positionMarks: 0, annotationLabels: 0, measurementLabels: 0 }
  ctx.clearRect(0, 0, width, height)
  if (state.variant === 'current') return stats
  ctx.fillStyle = palette.paper; ctx.fillRect(0, 0, width, height)
  const layers = new Map(model.source.layers.map((layer) => [layer.name, layer.visible ? layer.opacity : 0]))
  const alpha = (layer: string) => layers.get(layer) ?? 1
  const pointer = state.pointer ? screen(state.pointer, view) : null
  const positions: { point: PrintPoint; radius: number }[] = []
  const boxes: { x: number; y: number; width: number; height: number }[] = []
  const intersects = (a: typeof boxes[number], b: typeof boxes[number]) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  function label(text: string, x: number, y: number, size: number, force = false, rotation = 0): boolean {
    ctx.font = `${size}px sans-serif`
    const lines = text.split('\n')
    const w = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 6, h = lines.length * size * 1.25 + 4
    const radians = rotation * Math.PI / 180
    const corners = [[-3, -2], [w - 3, -2], [w - 3, h - 2], [-3, h - 2]].map(([a, b]) => ({ x: x + a! * Math.cos(radians) - b! * Math.sin(radians), y: y + a! * Math.sin(radians) + b! * Math.cos(radians) }))
    const left = Math.min(...corners.map((point) => point.x)), top = Math.min(...corners.map((point) => point.y))
    const box = { x: left, y: top, width: Math.max(...corners.map((point) => point.x)) - left, height: Math.max(...corners.map((point) => point.y)) - top }
    if (!force && (box.x < 4 || box.y < 4 || box.x + box.width > width - 4 || box.y + box.height > height - 4
      || boxes.some((other) => intersects(box, other))
      || positions.some(({ point, radius }) => intersects(box, { x: point.x - radius - 2, y: point.y - radius - 2, width: radius * 2 + 4, height: radius * 2 + 4 })))) return false
    boxes.push(box)
    ctx.save(); ctx.translate(x, y); ctx.rotate(radians)
    ctx.globalAlpha = 1; ctx.fillStyle = palette.paper; ctx.fillRect(-3, -2, w, h)
    ctx.fillStyle = palette.ink; ctx.textBaseline = 'top'
    lines.forEach((line, index) => ctx.fillText(line, 0, index * size * 1.25))
    ctx.restore()
    return true
  }
  // Retain the authored Zone outlines/fills; fine structural lines sit below Plants.
  if (alpha('zones')) for (const zone of model.source.zones) {
    ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.scale, view.scale)
    ctx.globalAlpha = alpha('zones') * .48; ctx.lineWidth = .8 / view.scale; ctx.strokeStyle = palette.muted
    const path = model.paths.get(zone.path)!
    if (zone.fill) { ctx.fillStyle = zone.fill; ctx.fill(path) }
    ctx.stroke(path); ctx.restore()
  }
  if (state.variant === 'strip' && state.stripX !== null) {
    const left = screen({ x: state.stripX - .5, y: 0 }, view).x
    ctx.globalAlpha = .08; ctx.fillStyle = palette.accent; ctx.fillRect(left, 0, view.scale, height)
    ctx.globalAlpha = .7; ctx.strokeStyle = palette.accent; ctx.lineWidth = 1; ctx.setLineDash([4, 5])
    ctx.beginPath(); ctx.moveTo(left, 0); ctx.lineTo(left, height); ctx.moveTo(left + view.scale, 0); ctx.lineTo(left + view.scale, height); ctx.stroke(); ctx.setLineDash([])
  }
  if (alpha('measurement-guides') && !detail) for (const guide of model.source.measurements) {
    const a = screen(guide.start, view), b = screen(guide.end, view)
    ctx.globalAlpha = .18 * alpha('measurement-guides'); ctx.strokeStyle = palette.muted; ctx.lineWidth = .65
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
  }
  if (alpha('plants')) model.source.plants.forEach((plant, index) => {
    const point = screen(plant.position, view)
    if (point.x < -15 || point.y < -15 || point.x > width + 15 || point.y > height + 15) return
    stats.visible++
    const originalRadius = 2 + 4.75 * view.scale / (view.scale + 21)
    const radius = detail ? Math.min(8, originalRadius) : Math.max(.65, Math.min(originalRadius, model.nearest[index]! * view.scale * .42))
    const full = radius >= 3.6
    if (full) stats.fullSymbols++; else stats.positionMarks++
    const emphasized = (!state.species || plant.canonicalName === state.species)
      && (state.variant !== 'strip' || state.stripX === null || Math.abs(plant.position.x - state.stripX) <= .5)
    ctx.globalAlpha = (emphasized ? 1 : .13) * alpha('plants')
    ctx.fillStyle = plant.color; ctx.strokeStyle = plant.color
    if (!full) { ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill() }
    else {
      ctx.save(); ctx.translate(point.x, point.y); ctx.scale(radius, radius)
      for (const mark of plant.mark) {
        const path = model.paths.get(mark.d)!
        if (mark.fill) ctx.fill(path)
        if (mark.stroke) { ctx.lineWidth = mark.strokeWidth; ctx.stroke(path) }
      }
      ctx.restore()
    }
    positions.push({ point, radius })
    if (plant.id === state.selectedId) {
      ctx.globalAlpha = 1; ctx.strokeStyle = palette.accent; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(point.x, point.y, radius + 4, 0, Math.PI * 2); ctx.stroke()
    }
  })
  if (alpha('annotations') && !detail) for (const note of model.source.annotations) {
    const point = screen(note.position, view)
    if (point.x < -20 || point.y < -20 || point.x > width || point.y > height) continue
    const hovered = pointer && distance(point, pointer) < 10
    const enoughSpace = view.scale >= 35
    if ((hovered || enoughSpace) && label(note.text, point.x, point.y, note.fontSize, Boolean(hovered), note.rotation)) stats.annotationLabels++
    else {
      ctx.globalAlpha = .35 * alpha('annotations'); ctx.strokeStyle = palette.accent; ctx.lineWidth = 1
      ctx.strokeRect(point.x - 1.5, point.y - 1.5, 3, 3)
    }
  }
  if (alpha('measurement-guides') && !detail) for (const guide of model.source.measurements) {
    const a = screen(guide.start, view), b = screen(guide.end, view)
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const hovered = pointer && distance(midpoint, pointer) < 12
    if (!hovered && (view.scale < 80 || distance(a, b) < 85)) continue
    const metres = distance(guide.start, guide.end)
    const text = metres < 1 ? `${Math.round(metres * 100)} cm` : `${Number(metres.toFixed(2))} m`
    if (label(text, midpoint.x + 5, midpoint.y - 18, 12, Boolean(hovered))) stats.measurementLabels++
  }
  // Names earn screen space too. Retain common names, with botanical fallback;
  // never repurpose marker size or invent species colours to encode identity.
  if (alpha('plants') && !detail && view.scale >= 100) model.source.plants.forEach((plant, index) => {
    if (model.nearest[index]! * view.scale < 35 || (state.species && plant.canonicalName !== state.species)) return
    if (state.variant === 'strip' && state.stripX !== null && Math.abs(plant.position.x - state.stripX) > .5) return
    const point = screen(plant.position, view)
    if (point.x < 0 || point.y < 0 || point.x > width || point.y > height) return
    const text = model.names.get(plant.canonicalName) ?? plant.canonicalName
    label(text, point.x + 14, point.y - 7, 12)
  })
  if (state.variant === 'lens' && state.pointer && !detail) {
    const point = screen(state.pointer, view)
    const factor = view.scale / Math.max(140, view.scale)
    ctx.globalAlpha = .9; ctx.strokeStyle = palette.accent; ctx.lineWidth = 1
    ctx.strokeRect(point.x - 140 * factor, point.y - 125 * factor, 280 * factor, 250 * factor)
  }
  ctx.globalAlpha = 1
  if (!detail) return stats // The real ruler overlay already owns the site scale bar.
  const barMetres = 10 ** Math.floor(Math.log10(100 / view.scale))
  const bar = barMetres * view.scale
  ctx.strokeStyle = palette.muted; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(30, height - 32); ctx.lineTo(30 + bar, height - 32); ctx.stroke()
  ctx.font = '11px sans-serif'; ctx.fillStyle = palette.muted; ctx.fillText(barMetres < 1 ? `${Math.round(barMetres * 100)} cm` : `${barMetres} m`, 30, height - 48)
  return stats
}
