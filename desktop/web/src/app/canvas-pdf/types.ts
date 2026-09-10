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
export interface PdfPrintArea { readonly id: string; readonly name: string; readonly bounds: PrintBounds }
export function pdfAreaKey(area: PdfPrintArea): string { return `area:${area.id}` }
export interface PdfSetup {
  readonly paper: PdfPaper
  readonly layers: readonly string[]
  readonly areas?: readonly PdfPrintArea[]
  readonly views?: Readonly<Record<string, PdfPageView>>
}
export interface PdfInput { readonly name: string; readonly locale: string; readonly canvas: CanvasPrintSnapshot; readonly commonNames: Readonly<Record<string, string>> }
export interface PdfLabels { readonly notes: string; readonly observations: string; readonly keyAndNotes: string; readonly overview: string; readonly plants: string; readonly actualSize: string; }
export type PdfMatrix = readonly [number, number, number, number, number, number]
export type PdfOperation =
  | { readonly kind: 'path'; readonly d: string; readonly matrix: PdfMatrix; readonly fill: string | null; readonly stroke: string | null; readonly width: number; readonly opacity: number }
  | { readonly kind: 'text'; readonly line: TextLine; readonly x: number; readonly y: number; readonly size: number; readonly rotation: number; readonly opacity: number; readonly color?: string }
  | { readonly kind: 'clip'; readonly bounds: PrintBounds }
  | { readonly kind: 'unclip' }
export interface PdfLegendEntry { readonly reference?: string; readonly count?: number; readonly code?: string; readonly canonicalName: string; readonly name: string; readonly appearances: readonly PrintPlant[] }
export interface PdfLink { readonly bounds: PrintBounds; readonly target: string }
export interface PdfDestination { readonly id: string; readonly bounds?: PrintBounds }
export interface PdfPageReference { readonly target: string; readonly x: number; readonly y: number; readonly size: number }
export interface PdfPage {
  readonly pageReferences?: readonly PdfPageReference[]
  readonly links?: readonly PdfLink[]
  readonly destinations?: readonly PdfDestination[]
  readonly identifiedPlants?: readonly { readonly ids: readonly string[]; readonly reference: string; readonly bounds: PrintBounds }[]
  readonly annotationIds?: readonly string[]
  readonly measurementIds?: readonly string[]
  readonly number: number
  readonly width: number
  readonly height: number
  readonly kind: 'overview' | 'detail' | 'legend'
  readonly id: string
  readonly sourceId?: string
  readonly continuationIds?: readonly string[]
  readonly areaKey?: string
  readonly areaName?: string
  readonly frame: PrintBounds
  readonly ground: PrintBounds
  readonly pointsPerMeter: number
  readonly operations: readonly PdfOperation[]
  readonly legend: readonly PdfLegendEntry[]
}
export interface PdfPlan {
  /** Fitted navigation surface for adding areas; never encoded as a PDF page. */
  readonly pickerPage?: PdfPage
  readonly pages: readonly PdfPage[]
  readonly outlines: Record<string, GlyphOutline>
  readonly blocked: 'empty' | null
}
export interface PdfLayoutCacheEntry { readonly key: string; readonly pages: readonly PdfPage[]; readonly outlines: Record<string, GlyphOutline> }
export type PdfLayoutCache = Readonly<Record<string, PdfLayoutCacheEntry>>
export interface PreparedPdf { readonly layoutCache?: PdfLayoutCache; readonly plan: PdfPlan; readonly bytes: Uint8Array | null }
