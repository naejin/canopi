import type { CanvasPrintSnapshot, PrintBounds, PrintPlant } from '../../canvas/print'
import type { GlyphOutline, TextLine } from './text'
export type PdfPaper = 'A4' | 'Letter'
export type PdfOrientation = 'auto' | 'portrait' | 'landscape'
export const PDF_SCALES = [20, 50, 100, 200, 500, 1000] as const
export type PdfScale = typeof PDF_SCALES[number]
export type PdfAreaSelection =
  | { readonly kind: 'zone'; readonly name: string; readonly scale?: PdfScale }
  | { readonly kind: 'rectangle'; readonly id: string; readonly name: string; readonly bounds: PrintBounds; readonly scale?: PdfScale }
export function pdfAreaKey(area: PdfAreaSelection): string { return area.kind === 'zone' ? `zone:${area.name}` : `area:${area.id}` }
export interface PdfSetup {
  readonly paper: PdfPaper
  readonly orientation: PdfOrientation
  readonly layers: readonly string[]
  readonly areas?: readonly PdfAreaSelection[]
  readonly detailScale?: PdfScale
}
export interface PdfInput { readonly name: string; readonly locale: string; readonly canvas: CanvasPrintSnapshot; readonly commonNames: Readonly<Record<string, string>> }
export interface PdfLabels { readonly overview: string; readonly plants: string; readonly actualSize: string; readonly page: string }
export type PdfMatrix = readonly [number, number, number, number, number, number]
export type PdfOperation =
  | { readonly kind: 'path'; readonly d: string; readonly matrix: PdfMatrix; readonly fill: string | null; readonly stroke: string | null; readonly width: number; readonly opacity: number }
  | { readonly kind: 'text'; readonly line: TextLine; readonly x: number; readonly y: number; readonly size: number; readonly rotation: number; readonly opacity: number }
  | { readonly kind: 'clip'; readonly bounds: PrintBounds }
  | { readonly kind: 'unclip' }
export interface PdfLegendEntry { readonly canonicalName: string; readonly name: string; readonly appearances: readonly PrintPlant[] }
export interface PdfPage {
  readonly number: number
  readonly width: number
  readonly height: number
  readonly kind: 'overview' | 'detail'
  readonly id: string
  readonly areaKey?: string
  readonly areaName?: string
  readonly tile?: { readonly row: number; readonly column: number; readonly rows: number; readonly columns: number }
  readonly neighbors?: Readonly<Partial<Record<'left' | 'right' | 'top' | 'bottom', number>>>
  readonly frame: PrintBounds
  readonly ground: PrintBounds
  readonly pointsPerMeter: number
  readonly operations: readonly PdfOperation[]
  readonly legend: readonly PdfLegendEntry[]
  readonly overflow: boolean
  readonly ambiguousSpecies: readonly string[]
}
export interface PdfPlan { readonly pages: readonly PdfPage[]; readonly outlines: Record<string, GlyphOutline>; readonly blocked: 'empty' | 'legend-overflow' | null }
export interface PreparedPdf { readonly plan: PdfPlan; readonly bytes: Uint8Array | null }
