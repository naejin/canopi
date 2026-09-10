import type { PrintBounds, PrintPlant } from '../../canvas/print'
import { contains } from './field-geometry'

/** Previewable coverage partition. Coincident plants cannot be separated by cropping. */
export function splitFieldBounds(bounds: PrintBounds, plants: readonly PrintPlant[]): PrintBounds[] {
  const result: PrintBounds[] = []
  const partition = (ground: PrintBounds, depth: number) => {
    const positions = new Set(plants.filter(p => contains(ground, p.position)).map(p => `${p.position.x},${p.position.y}`))
    if (depth >= 5 || (depth > 0 && positions.size <= 120)) { result.push(ground); return }
    if (ground.width >= ground.height) {
      const width = ground.width / 2
      partition({ ...ground, width }, depth + 1)
      partition({ ...ground, x: ground.x + width, width }, depth + 1)
    } else {
      const height = ground.height / 2
      partition({ ...ground, height }, depth + 1)
      partition({ ...ground, y: ground.y + height, height }, depth + 1)
    }
  }
  partition(bounds, 0)
  return result
}
