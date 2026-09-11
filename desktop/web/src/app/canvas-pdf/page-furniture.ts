import type { PdfInput, PdfLabels, PdfOperation, PdfPage, PdfPaper } from './types'
import type { PdfTextEngine } from './text'
import { MM, pathOp, textOp } from './page-drawing'
import { fieldLabels } from './labels'

export function detailFurniture(page: PdfPage, input: PdfInput, labels: PdfLabels, paper: PdfPaper, text: PdfTextEngine): PdfOperation[] {
  const operations: PdfOperation[] = [], wording = fieldLabels(labels), margin = 10 * MM
  const emit = (value: string, x: number, y: number, size: number, right = false) => {
    const line = text.line(value, size)
    operations.push(textOp(line, right ? x - line.width : x, y, size))
  }
  const name = text.wrap(input.name, 8, page.width - 2 * margin)[0]!
  operations.push(textOp(name, margin, 10 * MM, 8))
  const identity = `${wording.detail} ${page.detailNumber}`
  emit(identity, margin, 18 * MM, 18)
  if (page.legend.length) emit(`${page.legend.reduce((n, e) => n + (e.count ?? 0), 0)} ${labels.plants} · ${page.legend.length} ${wording.species}`, page.width - margin, 18 * MM, 8, true)
  operations.push(pathOp(`M${margin} ${22 * MM} h${page.width - 2 * margin}`, '#d8d2c8', null, .2 * MM))
  const y = page.height - 10 * MM
  operations.push(pathOp(`M${margin} ${page.height - 16 * MM} h${page.width - 2 * margin}`, '#d8d2c8', null, .2 * MM))
  emit(identity, margin, y + 1.5 * MM, 8)
  emit(`${labels.actualSize} · ${paper}`, page.width - margin, y + 1.5 * MM, 7.5, true)
  operations.push(...groundScale(page, input.locale, text))
  return operations
}

export function groundScale(page: Pick<PdfPage, 'width' | 'height' | 'pointsPerMeter'>, locale: string, text: PdfTextEngine): PdfOperation[] {
  const operations: PdfOperation[] = [], y = page.height - 10 * MM
  const emit = (value: string, x: number, y: number, size: number, right = false) => {
    const line = text.line(value, size)
    operations.push(textOp(line, right ? x - line.width : x, y, size))
  }
  const wanted = 35 * MM / page.pointsPerMeter, magnitude = 10 ** Math.floor(Math.log10(wanted))
  const metres = [1, 2, 5].map(n => n * magnitude).filter(n => n <= wanted).pop() ?? magnitude
  const length = metres * page.pointsPerMeter, x = (page.width - length) / 2
  operations.push(pathOp(`M${x} ${y + MM} h${length} M${x} ${y} v${2 * MM} M${x + length / 2} ${y} v${2 * MM} M${x + length} ${y} v${2 * MM}`, '#24211c', null, .2 * MM))
  emit('0', x, y - MM, 7)
  emit(`${new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 }).format(metres)} m`, x + length, y - MM, 7, true)
  return operations
}
