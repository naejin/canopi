import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { drawSpeciesCodes } from '../app/canvas-pdf/species-codes'
import { identifyPlants } from '../app/canvas-pdf/page-drawing'
import { createPdfTextEngine, type PdfFontId } from '../app/canvas-pdf/text'
import type { PdfInput, PdfOperation } from '../app/canvas-pdf/types'

const fonts = new Map<PdfFontId, Uint8Array>([
  ['latin', readFileSync('public/pdf-fonts/NotoSans-Regular.ttf')],
])
const input: PdfInput = {
  name: 'Garden',
  locale: 'en',
  commonNames: { 'Mentha spicata': 'Mint' },
  canvas: {
    layers: [{ name: 'plants', visible: true, opacity: 0.5 }],
    zones: [],
    annotations: [],
    measurements: [],
    plants: Array.from({ length: 10 }, (_, index) => ({
      id: String(index),
      canonicalName: 'Mentha spicata',
      speciesCode: 'MSP',
      position: { x: 5, y: 5 },
      color: '#3E8E4E',
      symbol: 'herb',
      mark: [],
      pinnedName: false,
    })),
  },
}

describe('printed Species key', () => {
  it('uses the captured code alongside full species identity', () => {
    expect(
      identifyPlants(input.canvas.plants, input.commonNames, 'en'),
    ).toEqual([
      expect.objectContaining({
        canonicalName: 'Mentha spicata',
        name: 'Mint',
        code: 'MSP',
      }),
    ])
  })
  it('prints a single readable code for coincident plants and respects layer opacity', () => {
    const operations: PdfOperation[] = []
    drawSpeciesCodes(
      input,
      { x: 0, y: 0, width: 300, height: 300 },
      { x: 0, y: 0, width: 30, height: 30 },
      10,
      createPdfTextEngine(fonts, 'en'),
      operations,
      [],
    )
    expect(operations).toHaveLength(1)
    expect(operations[0]).toMatchObject({ kind: 'text', opacity: 0.5 })
    expect(
      operations.flatMap((op) =>
        op.kind === 'text' ? op.line.runs.map((run) => run.text) : [],
      ),
    ).toEqual(['MSP'])
  })
})
