import { textGraphemes } from '../../utils/text-graphemes'
import type { InspectionLabel, InspectionPoint, InspectedPlant } from '../inspection'
import { LabelCollisionIndex } from '../label-collision'
import { nearestPlantSpacing } from '../plant-spacing'
import type { ScenePlantEntity } from './scene'

// Matches the lens name buttons: 12px type, 16px lines, 4px padding.
export const INSPECTION_TYPE = { size: 12, line: 16, padding: 4 } as const

export function inspectionLayout(plants: readonly ScenePlantEntity[], centre: InspectionPoint,
  frame: { width: number; height: number }, names: ReadonlyMap<string, string | null>, measure: (text: string) => number,
  magnification = 1): { scale: number; plants: InspectedPlant[] } {
  const ordered = plants.map(plant => ({ plant, distanceM: Math.hypot(plant.position.x - centre.x, plant.position.y - centre.y) }))
    .sort((a, b) => a.distanceM - b.distanceM || a.plant.id.localeCompare(b.plant.id))
  const spacing = ordered.slice(0, 7).map(({ plant }) => nearestPlantSpacing(plants, plant.position)).sort((a, b) => a - b)
  const scale = Math.max(140, Math.min(600, 100 / (spacing[Math.floor(spacing.length / 2)] ?? Infinity))) * magnification
  const visible = ordered.map(({ plant, distanceM }) => ({ plant, distanceM, screenPosition: {
    x: frame.width / 2 + (plant.position.x - centre.x) * scale,
    y: frame.height / 2 + (plant.position.y - centre.y) * scale,
  } })).filter(({ screenPosition: p }) => p.x >= 0 && p.y >= 0 && p.x <= frame.width && p.y <= frame.height)
  const occupied = new LabelCollisionIndex()
  for (const { screenPosition: p } of visible) occupied.add({ x: p.x - 10, y: p.y - 10, width: 20, height: 20 })
  return { scale, plants: visible.map(({ plant, distanceM, screenPosition: p }) => {
    const name = names.get(plant.canonicalName)?.trim() || plant.commonName?.trim() || plant.canonicalName
    const lines = wrapName(name, Math.max(1, Math.min(220, frame.width - 24) - 8), measure)
    const width = Math.max(...lines.map(measure)) + 8, height = lines.length * INSPECTION_TYPE.line + 8
    const centredX = Math.max(4, Math.min(frame.width - width - 4, p.x - width / 2))
    const candidates = [
      { x: centredX, y: p.y + 13 }, { x: centredX, y: p.y - 13 - height },
      { x: p.x + 13, y: p.y - height / 2 }, { x: p.x - 13 - width, y: p.y - height / 2 },
    ]
    const bounds = candidates.map(position => ({ ...position, width, height }))
      .find(box => box.x >= 4 && box.y >= 4 && box.x + width <= frame.width - 4 && box.y + height <= frame.height - 4 && !occupied.overlaps(box))
    let label: InspectionLabel | null = null
    if (bounds) { occupied.add(bounds); label = { ...bounds, lines } }
    return { id: plant.id, name, position: { ...plant.position }, distanceM, screenPosition: p, label }
  }) }
}

function wrapName(name: string, width: number, measure: (text: string) => number): string[] {
  const result: string[] = []
  let line = ''
  // Grapheme boundaries retain accents, combining marks and CJK without ellipses.
  for (const segment of textGraphemes(name)) {
    if (line && measure(line + segment) > width) { result.push(line); line = '' }
    line += segment
  }
  if (line) result.push(line)
  return result.length ? result : ['']
}
