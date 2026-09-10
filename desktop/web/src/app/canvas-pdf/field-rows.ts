import type { PrintPlant } from '../../canvas/print'
import { nearestPlantSpacing } from '../../canvas/plant-spacing'
import { PaperIndex, distance } from './field-geometry'

const appearance = (p: PrintPlant) => JSON.stringify([p.canonicalName, p.symbol, p.color.toLowerCase()])

/** Infer straight runs from neighbouring placements, never from species alone. */
export function plantingRows(plants: readonly PrintPlant[], bedDirections: readonly number[] = []): readonly (readonly PrintPlant[])[] {
  if (plants.length < 3) return []
  const spacing = plants.map(p => nearestPlantSpacing(plants, p.position)).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  const typical = spacing[Math.floor(spacing.length / 2)] ?? 1
  const index = new PaperIndex<PrintPlant>(typical * 4)
  for (const p of plants) index.add(p, { ...p.position, width: 0, height: 0 })
  const directions = new Map<number, number>([[0, 0], [900, 0]])
  for (const p of plants) {
    const radius = Math.min(typical * 20, nearestPlantSpacing(plants, p.position) * 6)
    if (!Number.isFinite(radius)) continue
    const neighbours = index.query({ x: p.position.x - radius, y: p.position.y - radius, width: radius * 2, height: radius * 2 })
      .filter(q => q !== p && appearance(q) === appearance(p) && distance(p.position, q.position) > 1e-8 && distance(p.position, q.position) <= radius)
      .sort((a, b) => distance(p.position, a.position) - distance(p.position, b.position)).slice(0, 16)
    for (const q of neighbours) {
      const angle = (Math.atan2(q.position.y - p.position.y, q.position.x - p.position.x) + Math.PI) % Math.PI
      const key = Math.round(angle * 1800 / Math.PI) % 1800
      directions.set(key, (directions.get(key) ?? 0) + 1)
    }
  }
  const candidates: PrintPlant[][] = []
  // Limit orientation hypotheses, not membership; irregular layouts remain individual.
  const angles = new Map<number, number>()
  for (const theta of bedDirections) { const angle = (theta + Math.PI) % Math.PI * 1800 / Math.PI; angles.set(Math.round(angle), angle) }
  for (const [angle] of [...directions].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 12)) if (!angles.has(angle)) angles.set(angle, angle)
  for (const angle of angles.values()) {
    const theta = angle * Math.PI / 1800, ux = Math.cos(theta), uy = Math.sin(theta)
    const tolerance = Math.min(.035, typical * .2)
    for (const shift of [0, .5]) {
      const lines = new Map<number, PrintPlant[]>()
      for (const p of plants) {
        const key = Math.floor((-p.position.x * uy + p.position.y * ux) / (2 * tolerance) + shift)
        let row = lines.get(key)
        if (!row) lines.set(key, row = [])
        row.push(p)
      }
      for (const line of lines.values()) {
        line.sort((a, b) => (a.position.x - b.position.x) * ux + (a.position.y - b.position.y) * uy || a.id.localeCompare(b.id))
        let run: PrintPlant[] = [], step = 0
        const emit = () => { if (run.length >= 3) candidates.push(run); run = []; step = 0 }
        for (const p of line) {
          const previous = run[run.length - 1], gap = previous ? distance(previous.position, p.position) : 0
          if (previous && (appearance(p) !== appearance(previous) || gap < 1e-8 || gap > Math.max(1.05, typical * 4) || (step && (gap > step * 1.8 || gap < step / 1.8)))) emit()
          if (run.length === 1) step = gap
          run.push(p)
        }
        emit()
      }
    }
  }
  const used = new Set<string>(), result: PrintPlant[][] = []
  candidates.sort((a, b) => b.length - a.length || a[0]!.id.localeCompare(b[0]!.id))
  for (const candidate of candidates) {
    let run: PrintPlant[] = []
    const emit = () => { if (run.length >= 3) { result.push(run); run.forEach(p => used.add(p.id)) }; run = [] }
    for (const p of candidate) { if (used.has(p.id)) emit(); else run.push(p) }
    emit()
  }
  return result
}
