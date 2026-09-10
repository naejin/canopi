import { LabelCollisionIndex } from '../../canvas/label-collision'
import type { PrintBounds } from '../../canvas/print'
import type { CanvasText } from './canvas-text'
import { paperPlantRadius } from './plant-marks'
import { PRINT, MM } from './print-style'
import type { PdfInput, PdfOperation } from './types'
import type { PdfTextEngine } from './text'

/** Optional detail labels never displace authored text or change coverage obligations. */
export function drawSpeciesCodes(
  input: PdfInput,
  frame: PrintBounds,
  ground: PrintBounds,
  scale: number,
  text: PdfTextEngine,
  operations: PdfOperation[],
  authoredLabels: readonly CanvasText[],
): void {
  const occupied = new LabelCollisionIndex()
  for (const item of authoredLabels) occupied.add(item.bounds)
  const points = input.canvas.plants.map((plant) => ({
    plant,
    x: frame.x + (plant.position.x - ground.x) * scale,
    y: frame.y + (plant.position.y - ground.y) * scale,
    radius: paperPlantRadius(input.canvas.plants, plant, scale),
  }))
  for (const { x, y, radius } of points)
    occupied.add({
      x: x - radius - MM,
      y: y - radius - MM,
      width: 2 * (radius + MM),
      height: 2 * (radius + MM),
    })
  const opacity =
    input.canvas.layers.find((layer) => layer.name === 'plants')?.opacity ?? 1
  for (const { plant, x, y, radius } of points) {
    if (!plant.speciesCode || plant.pinnedName) continue
    const line = text.line(plant.speciesCode, PRINT.text)
    const bounds = {
      x: x - line.width / 2 - MM,
      y: y + radius + MM,
      width: line.width + 2 * MM,
      height: PRINT.line,
    }
    if (
      bounds.x < frame.x ||
      bounds.y < frame.y ||
      bounds.x + bounds.width > frame.x + frame.width ||
      bounds.y + bounds.height > frame.y + frame.height ||
      occupied.overlaps(bounds)
    )
      continue
    occupied.add(bounds)
    operations.push({
      kind: 'text',
      line,
      x: bounds.x + MM,
      y: bounds.y + PRINT.text,
      size: PRINT.text,
      rotation: 0,
      opacity,
    })
  }
}
