import type { PrintBounds } from '../../canvas/print'
import type { FieldDrawing } from './field-layout'
import { fieldKey, type FieldKeyBody, type KeyGeometry } from './field-key'
import type { PdfLabels } from './types'
import type { PdfTextEngine } from './text'
import { pathOp } from './page-drawing'
import { MM } from './print-style'
import { hits, inflate, outlineSegments, overlaps, rotatedBounds } from './field-geometry'

/** A full key may occupy spare paper only when every row and existing ink fits. */
export function integratedKey(drawing: FieldDrawing, id: string, geometry: KeyGeometry,
  continuation: (index: number) => KeyGeometry, text: PdfTextEngine, labels: PdfLabels, opacity: number): FieldKeyBody | undefined {
  const { frame, width, height } = geometry, gap = 6 * MM, margin = 10 * MM, top = geometry.bodyTop ?? 26 * MM, bottom = height - 20 * MM
  const regions: PrintBounds[] = geometry.keyFrame ? [geometry.keyFrame] : [
    { x: frame.x + frame.width + gap, y: top, width: width - margin - frame.x - frame.width - gap, height: bottom - top },
    { x: margin, y: top, width: frame.x - gap - margin, height: bottom - top },
    { x: margin, y: frame.y + frame.height + gap, width: width - 2 * margin, height: bottom - frame.y - frame.height - gap },
    { x: margin, y: top, width: width - 2 * margin, height: frame.y - gap - top },
  ]
  for (const region of regions.filter(r => r.width >= 52 * MM && r.height >= 15 * MM).sort((a, b) => b.width * b.height - a.width * a.height)) {
    let clipped = false
    const occupied = drawing.operations.some(op => {
      if (op.kind === 'clip') { clipped = true; return false }
      if (op.kind === 'unclip') { clipped = false; return false }
      if (clipped) return false
      if (op.kind === 'text' && op.line.ink) {
        return overlaps(inflate(rotatedBounds(op.line.ink, op.rotation, op), MM), region)
      }
      if (op.kind !== 'path') return false
      const [a, b, c, d, x, y] = op.matrix
      return outlineSegments(op.d, p => ({ x: a * p.x + c * p.y + x, y: b * p.x + d * p.y + y })).some(s => hits(s, region))
    })
    if (occupied) continue
    const columns = Math.max(1, Math.min(3, Math.floor(region.width / (70 * MM))))
    const bodies = fieldKey(drawing, id, index => index ? continuation(index - 1) : { width, height, frame: region, columns, compact: true }, text, labels, opacity)
    if (bodies.length === 1) {
      const body = bodies[0]!
      if (region.x >= frame.x + frame.width + gap) body.operations.unshift(pathOp(`M${region.x - gap / 2} ${region.y} v${region.height}`, '#d8d2c8', null, .15 * MM))
      return body
    }
  }
  return undefined
}
