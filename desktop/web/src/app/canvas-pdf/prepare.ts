import { buildPdfPlan, printableCanvas } from './layout'
import { createPdfTextEngine, loadPdfFonts } from './text'
import { encodePdf } from './encode'
import type { PdfInput, PdfLabels, PdfSetup, PreparedPdf } from './types'
export interface PdfPreparation { readonly input: PdfInput; readonly setup: PdfSetup; readonly labels: PdfLabels; readonly fontBaseUrl: string }
export async function preparePdf({ input, setup, labels, fontBaseUrl }: PdfPreparation): Promise<PreparedPdf> {
  const selected = printableCanvas(input.canvas, setup.layers)
  const texts = [input.name, ...Object.values(labels), '50 mm · 0.0123456789 m 1:1000',
    ...selected.plants.flatMap((p) => [p.canonicalName, input.commonNames[p.canonicalName] ?? '']),
    ...selected.annotations.map((a) => a.text)]
  const fonts = await loadPdfFonts(texts, input.locale, fontBaseUrl)
  const text = createPdfTextEngine(fonts, input.locale)
  const plan = buildPdfPlan(input, setup, text, labels)
  const bytes = plan.blocked ? null : await encodePdf(plan, fonts, input.name)
  return { plan, bytes }
}
