import type { CanvasPrintSnapshot, PrintBounds, PrintPlant } from '../../canvas/print'
import type { GlyphOutline, TextLine } from './text'
export type PdfPaper = 'A4' | 'Letter'
export type PdfOrientation = 'auto' | 'portrait' | 'landscape'
export const PDF_ZOOM = { min: 1, max: 1000 } as const
export interface PdfPageView {
  readonly zoom?: number
  readonly orientation?: PdfOrientation
  /** Ground-space displacement from the fitted centre, in metres. */
  readonly offset?: { readonly x: number; readonly y: number }
}
export type PdfAreaSelection =
  | { readonly kind: 'zone'; readonly name: string }
  | { readonly kind: 'rectangle'; readonly id: string; readonly name: string; readonly bounds: PrintBounds }
export function pdfAreaKey(area: PdfAreaSelection): string { return area.kind === 'zone' ? `zone:${encodeURIComponent(area.name)}` : `area:${area.id}` }
export interface PdfSetup {
  readonly paper: PdfPaper
  readonly layers: readonly string[]
  readonly areas?: readonly PdfAreaSelection[]
  readonly views?: Readonly<Record<string, PdfPageView>>
  readonly continuations?: boolean
}
export interface PdfInput { readonly name: string; readonly locale: string; readonly canvas: CanvasPrintSnapshot; readonly commonNames: Readonly<Record<string, string>> }
export interface PdfLabels { readonly overview: string; readonly plants: string; readonly actualSize: string; readonly page: string; readonly continued: string; readonly legendFor: string }
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
  readonly kind: 'overview' | 'detail' | 'legend'
  readonly id: string
  readonly sourceId?: string
  readonly continuationIds?: readonly string[]
  readonly legendLink?: PrintBounds
  readonly areaKey?: string
  readonly areaName?: string
  readonly frame: PrintBounds
  readonly ground: PrintBounds
  readonly pointsPerMeter: number
  readonly operations: readonly PdfOperation[]
  readonly legend: readonly PdfLegendEntry[]
  readonly overflow: boolean
  readonly ambiguousSpecies: readonly string[]
}
export interface PdfPlan {
  /** Fitted navigation surface for adding areas; never encoded as a PDF page. */
  readonly pickerPage?: PdfPage
  readonly hasLegendOverflow?: boolean
  readonly pages: readonly PdfPage[]
  readonly outlines: Record<string, GlyphOutline>
  readonly blocked: 'empty' | 'legend-overflow' | null
}
export interface PreparedPdf { readonly plan: PdfPlan; readonly bytes: Uint8Array | null }
