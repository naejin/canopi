import { create, type Font } from 'fontkit'
import assets from './font-assets.json'

export type PdfFontId = 'latin' | 'sc' | 'jp' | 'kr'
export interface TextRun {
  readonly text: string
  readonly font: PdfFontId
  readonly width: number
  readonly glyphs: readonly { readonly key: string; readonly x: number; readonly y: number }[]
}
export interface TextLine { readonly runs: readonly TextRun[]; readonly width: number }
export interface GlyphOutline { readonly path: string; readonly unitsPerEm: number }
export interface PdfTextEngine {
  readonly outlines: Record<string, GlyphOutline>
  line(text: string, size: number): TextLine
  wrap(text: string, size: number, width: number): TextLine[]
}
export class PdfTextError extends Error {
  constructor(readonly kind: 'unsupported-text' | 'text-too-wide', readonly character?: string) { super(kind) }
}

export async function loadPdfFonts(texts: readonly string[], locale: string, baseUrl: string): Promise<Map<PdfFontId, Uint8Array>> {
  const bytes = new Map<PdfFontId, Uint8Array>()
  async function load(id: PdfFontId): Promise<Font> {
    const asset = assets.find((entry) => entry.id === id)!
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 30_000)
    try {
      const response = await fetch(new URL(asset.file, baseUrl), { signal: abort.signal })
      if (!response.ok) throw new Error('font-load')
      const data = new Uint8Array(await response.arrayBuffer())
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (b) => b.toString(16).padStart(2, '0')).join('')
      if (digest !== asset.sha256) throw new Error('font-integrity')
      bytes.set(id, data)
      return create(data)
    } finally { clearTimeout(timer) }
  }
  const latin = await load('latin')
  const needed = new Set<PdfFontId>()
  for (const text of texts) {
    for (const char of text.replace(/[\n\r\t]/g, '')) {
      if (!latin.hasGlyphForCodePoint(char.codePointAt(0)!)) needed.add(regionalFont(char, locale))
    }
  }
  for (const id of needed) await load(id)
  return bytes
}

function regionalFont(character: string, locale: string): PdfFontId {
  if (/[\u3040-\u30ff]/u.test(character)) return 'jp'
  if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u.test(character)) return 'kr'
  return locale.startsWith('ja') ? 'jp' : locale.startsWith('ko') ? 'kr' : 'sc'
}

export function createPdfTextEngine(bytes: ReadonlyMap<PdfFontId, Uint8Array>, locale: string): PdfTextEngine {
  const fonts = new Map(Array.from(bytes, ([id, data]) => [id, create(data)]))
  const outlines: Record<string, GlyphOutline> = {}
  const latin = fonts.get('latin')!
  const cache = new Map<string, TextLine>()
  function line(raw: string, size: number): TextLine {
    const text = raw.normalize('NFC').replace(/\t/g, '    ')
    const key = `${size}:${text}`
    const previous = cache.get(key)
    if (previous) return previous
    const parts: { font: PdfFontId; text: string }[] = []
    for (const char of text) {
      const code = char.codePointAt(0)!
      const id: PdfFontId = latin.hasGlyphForCodePoint(code) ? 'latin' : regionalFont(char, locale)
      const font = fonts.get(id)
      if (!font?.hasGlyphForCodePoint(code)) throw new PdfTextError('unsupported-text', char)
      const last = parts[parts.length - 1]
      if (last?.font === id) last.text += char
      else parts.push({ font: id, text: char })
    }
    const runs = parts.map((part): TextRun => {
      const font = fonts.get(part.font)!
      const layout = font.layout(part.text)
      let x = 0
      const glyphs = layout.glyphs.map((glyph, index) => {
        const position = layout.positions[index]!
        const key = `${part.font}:${glyph.id}`
        outlines[key] ??= { path: glyph.path.toSVG(), unitsPerEm: font.unitsPerEm }
        const item = { key, x: (x + position.xOffset) * size / font.unitsPerEm, y: -position.yOffset * size / font.unitsPerEm }
        x += position.xAdvance
        return item
      })
      return { ...part, width: layout.advanceWidth * size / font.unitsPerEm, glyphs }
    })
    const result = { runs, width: runs.reduce((sum, run) => sum + run.width, 0) }
    cache.set(key, result)
    return result
  }
  function wrap(text: string, size: number, width: number): TextLine[] {
    const result: TextLine[] = []
    for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
      let current = ''
      // Prefer word boundaries; long words/CJK can break between complete graphemes.
      for (const word of paragraph.split(/(\s+)/u).filter(Boolean)) {
        if (line(current + word, size).width <= width) { current += word; continue }
        if (current.trim()) { result.push(line(current.trimEnd(), size)); current = '' }
        if (!word.trim()) continue
        if (line(word, size).width <= width) { current = word; continue }
        for (const cluster of graphemes(word)) {
          if (line(current + cluster, size).width > width) {
            if (!current) throw new PdfTextError('text-too-wide')
            result.push(line(current, size)); current = ''
            if (line(cluster, size).width > width) throw new PdfTextError('text-too-wide')
          }
          current += cluster
        }
      }
      result.push(line(current.trimEnd(), size))
    }
    return result
  }
  return { outlines, line, wrap }
}

function graphemes(text: string): string[] {
  const segments: string[] = []
  for (const char of text.normalize('NFC')) {
    const previous = segments[segments.length - 1]
    if (previous !== undefined && (/\p{Mark}|[\u200d\ufe0f]/u.test(char) || previous.endsWith('\u200d'))) segments[segments.length - 1] += char
    else segments.push(char)
  }
  return segments
}
