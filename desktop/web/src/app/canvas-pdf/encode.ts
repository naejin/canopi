import { PDFDocument } from 'pdfkit'
import type { PdfFontId } from './text'
import type { PdfPlan } from './types'

export async function encodePdf(plan: PdfPlan, fonts: ReadonlyMap<PdfFontId, Uint8Array>, title: string): Promise<Uint8Array> {
  if (plan.blocked) throw new Error(plan.blocked)
  const doc = new PDFDocument({ autoFirstPage: false, font: null, compress: true,
    info: { Title: title, Creator: 'Canopi', CreationDate: new Date() } })
  for (const [id, bytes] of fonts) doc.registerFont(id, bytes)
  const chunks: Uint8Array[] = []
  const output = new Promise<Uint8Array>((resolve, reject) => {
    doc.on('error', reject)
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => {
      const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0))
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      resolve(bytes)
    })
  })
  for (const page of plan.pages) {
    doc.addPage({ size: [page.width, page.height], margin: 0 })
    doc.rect(0, 0, page.width, page.height).fill('#ffffff')
    for (const op of page.operations) {
      if (op.kind === 'clip') { doc.save().rect(op.bounds.x, op.bounds.y, op.bounds.width, op.bounds.height).clip(); continue }
      if (op.kind === 'unclip') { doc.restore(); continue }
      doc.save().opacity(op.opacity)
      if (op.kind === 'text') {
        doc.translate(op.x, op.y).rotate(op.rotation).fillColor('#24211c')
        let x = 0
        for (const run of op.line.runs) {
          doc.font(run.font).fontSize(op.size).text(run.text, x, 0, { baseline: 'alphabetic', lineBreak: false, features: [] })
          x += run.width
        }
      } else {
        doc.transform(...op.matrix).lineWidth(op.width).lineJoin('round').lineCap('round').path(op.d)
        const fill = op.fill ? pdfPaint(op.fill) : null
        const stroke = op.stroke ? pdfPaint(op.stroke) : null
        if (fill) doc.fillOpacity(fill.alpha * op.opacity)
        if (stroke) doc.strokeOpacity(stroke.alpha * op.opacity)
        if (fill && stroke) doc.fillAndStroke(fill.color, stroke.color)
        else if (fill) doc.fill(fill.color)
        else if (stroke) doc.stroke(stroke.color)
      }
      doc.restore()
    }
  }
  doc.end()
  return output
}
function pdfPaint(value: string): { color: string; alpha: number } {
  const rgba = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i)
  if (rgba) return { color: '#' + rgba.slice(1, 4).map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, '0')).join(''), alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) }
  if (/^#[\da-f]{8}$/i.test(value)) return { color: value.slice(0, 7), alpha: parseInt(value.slice(7), 16) / 255 }
  if (value === 'transparent') return { color: '#ffffff', alpha: 0 }
  return { color: value, alpha: 1 }
}
