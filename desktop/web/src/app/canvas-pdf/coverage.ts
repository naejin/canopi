import type { PrintBounds } from '../../canvas/print'
export interface SheetCoverage {
  readonly row: number
  readonly column: number
  readonly rows: number
  readonly columns: number
  readonly ground: PrintBounds
}
/** Cover the requested ground without scaling or stretching the physical sheet. */
export function tileCoverage(bounds: PrintBounds, width: number, height: number, overlap: number): SheetCoverage[] {
  const columns = Math.max(1, Math.ceil((bounds.width - overlap) / (width - overlap) - 1e-9))
  const rows = Math.max(1, Math.ceil((bounds.height - overlap) / (height - overlap) - 1e-9))
  if (!Number.isFinite(columns * rows) || columns * rows > 199) throw new Error('coverage-too-large')
  const coveredWidth = width + (columns - 1) * (width - overlap)
  const coveredHeight = height + (rows - 1) * (height - overlap)
  const x = bounds.x - (coveredWidth - bounds.width) / 2, y = bounds.y - (coveredHeight - bounds.height) / 2
  return Array.from({ length: columns * rows }, (_, index) => {
    const row = Math.floor(index / columns), column = index % columns
    return { row, column, rows, columns, ground: { x: x + column * (width - overlap), y: y + row * (height - overlap), width, height } }
  })
}
