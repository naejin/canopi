import { buildPdfPlan, printableCanvas } from './layout'
import { createPdfTextEngine, loadPdfFonts } from './text'
import { encodePdf } from './encode'
import type { PdfInput, PdfLabels, PdfSetup, PreparedPdf, PdfLayoutCache, PdfLayoutCacheEntry, PdfPlan } from './types'
export interface PdfPreparation { readonly cache?: PdfLayoutCache; readonly priority?: string; readonly input: PdfInput; readonly setup: PdfSetup; readonly labels: PdfLabels; readonly fontBaseUrl: string }
export async function preparePdf({ input, setup, labels, fontBaseUrl, cache, priority }: PdfPreparation, progress?: (plan: PdfPlan) => void): Promise<PreparedPdf> {
  const selected = printableCanvas(input.canvas, setup.layers)
  const texts = [input.name, ...(setup.areas ?? []).map((area) => area.name), ...Object.values(labels), '50 mm · 0.0123456789 m 1:1000',
    ...selected.plants.filter(p => setup.areas?.length || p.pinnedName).flatMap((p) => [p.canonicalName, input.commonNames[p.canonicalName] ?? '']),
    ...selected.annotations.map((a) => a.text)]
  const fonts = await loadPdfFonts(texts, input.locale, fontBaseUrl)
  const text = createPdfTextEngine(fonts, input.locale)
  const layoutCache: Record<string, PdfLayoutCacheEntry> = {}
  const overview = setup.areas?.length && progress ? buildPdfPlan(input, { ...setup, areas: [] }, text, labels) : undefined
  if (overview) progress?.(overview)
  const plan = buildPdfPlan(input, setup, text, labels, { cache, priority,
    retain: (id, entry) => { layoutCache[id] = entry },
    progress: pages => { if (overview) progress?.({ ...overview, pages: [...overview.pages, ...pages], outlines: { ...text.outlines } }) },
  })
  const bytes = plan.blocked ? null : await encodePdf(plan, fonts, input.name)
  return { plan, bytes, layoutCache }
}
