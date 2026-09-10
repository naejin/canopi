// The pinned browser builds accept Uint8Array. Their published legacy typings
// describe Node Buffer/default exports; keep this used surface browser-specific.
declare module 'fontkit' {
  export interface Font {
    readonly unitsPerEm: number
    hasGlyphForCodePoint(code: number): boolean
    layout(text: string): {
      readonly advanceWidth: number
      readonly glyphs: readonly { readonly id: number; readonly path: { toSVG(): string }; readonly bbox: {
        readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number
      } }[]
      readonly positions: readonly { readonly xAdvance: number; readonly xOffset: number; readonly yOffset: number }[]
    }
  }
  export function create(bytes: Uint8Array): Font
}
declare module 'pdfkit' {
  export class PDFDocument {
    constructor(options: { autoFirstPage: boolean; font: null; compress: boolean; info: Record<string, string | Date> })
    on(event: 'data', callback: (chunk: Uint8Array) => void): this
    on(event: 'end', callback: () => void): this
    on(event: 'error', callback: (error: Error) => void): this
    registerFont(name: string, bytes: Uint8Array): this
    addPage(options: { size: [number, number]; margin: number }): this
    addNamedDestination(name: string, type: 'Fit' | 'FitR', ...coordinates: number[]): this
    goTo(x: number, y: number, width: number, height: number, target: string): this
    save(): this
    restore(): this
    transform(a: number, b: number, c: number, d: number, e: number, f: number): this
    translate(x: number, y: number): this
    rotate(angle: number): this
    font(name: string): this
    fontSize(size: number): this
    fillColor(color: string): this
    strokeColor(color: string): this
    opacity(opacity: number): this
    fillOpacity(opacity: number): this
    strokeOpacity(opacity: number): this
    lineWidth(width: number): this
    lineJoin(join: 'round'): this
    lineCap(cap: 'round'): this
    path(path: string): this
    rect(x: number, y: number, width: number, height: number): this
    fill(color?: string): this
    stroke(color?: string): this
    fillAndStroke(fill: string, stroke: string): this
    clip(): this
    text(text: string, x: number, y: number, options: { baseline: 'alphabetic'; lineBreak: false; features: readonly string[] }): this
    end(): void
  }
}
