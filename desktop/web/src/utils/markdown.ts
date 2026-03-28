/**
 * Lightweight markdown-to-VNode renderer for bundled articles.
 *
 * Handles: headings, bold, italic, unordered/ordered lists, links, paragraphs.
 * Outputs Preact VNodes — no innerHTML / dangerouslySetInnerHTML.
 *
 * NOT intended for arbitrary user content. Only used with trusted bundled articles.
 */
import { h } from 'preact'
import type { ComponentChildren } from 'preact'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyVNode = preact.VNode<any>
type Inline = string | AnyVNode

/** Parse inline markdown (bold, italic, links, code) within a text string. */
function parseInline(text: string): Inline[] {
  const result: Inline[] = []
  const inlineRegex = /\*\*(.+?)\*\*|_(.+?)_|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\(([^)]+)\)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index))
    }

    if (match[1] != null) {
      result.push(h('strong', null, match[1]))
    } else if (match[2] != null) {
      result.push(h('em', null, match[2]))
    } else if (match[3] != null) {
      result.push(h('em', null, match[3]))
    } else if (match[4] != null) {
      result.push(h('code', null, match[4]))
    } else if (match[5] != null && match[6] != null) {
      result.push(
        h('a', { href: match[6], target: '_blank', rel: 'noopener noreferrer' }, match[5]),
      )
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex))
  }

  return result.length > 0 ? result : [text]
}

interface Block {
  type: 'heading' | 'paragraph' | 'ul' | 'ol'
  level?: number
  children: ComponentChildren[]
  items?: ComponentChildren[][]
}

/** Parse markdown string into an array of block-level structures. */
function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    // Blank line — skip
    if (line.trim() === '') {
      i++
      continue
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1]!.length,
        children: parseInline(headingMatch[2]!),
      })
      i++
      continue
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: ComponentChildren[][] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        const itemText = lines[i]!.replace(/^\s*[-*]\s+/, '')
        items.push(parseInline(itemText))
        i++
      }
      blocks.push({ type: 'ul', children: [], items })
      continue
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ComponentChildren[][] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        const itemText = lines[i]!.replace(/^\s*\d+\.\s+/, '')
        items.push(parseInline(itemText))
        i++
      }
      blocks.push({ type: 'ol', children: [], items })
      continue
    }

    // Paragraph — collect contiguous non-blank, non-special lines
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !/^#{1,6}\s+/.test(lines[i]!) &&
      !/^\s*[-*]\s+/.test(lines[i]!) &&
      !/^\s*\d+\.\s+/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!)
      i++
    }
    if (paraLines.length > 0) {
      blocks.push({
        type: 'paragraph',
        children: parseInline(paraLines.join(' ')),
      })
    }
  }

  return blocks
}

/** Render a markdown string to an array of Preact VNodes. */
export function renderMarkdown(markdown: string): AnyVNode[] {
  const blocks = parseBlocks(markdown)
  return blocks.map((block, idx): AnyVNode => {
    switch (block.type) {
      case 'heading': {
        const tag = `h${block.level ?? 2}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
        return h(tag, { key: idx }, ...block.children)
      }
      case 'ul':
        return h(
          'ul',
          { key: idx },
          ...(block.items ?? []).map((item, j) => h('li', { key: j }, ...item)),
        )
      case 'ol':
        return h(
          'ol',
          { key: idx },
          ...(block.items ?? []).map((item, j) => h('li', { key: j }, ...item)),
        )
      case 'paragraph':
      default:
        return h('p', { key: idx }, ...block.children)
    }
  })
}
