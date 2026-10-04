import type { ReferenceNode, ReferenceRow } from './reference-tree'

/** What grouping needs of a Layers row: the analysis definition a result belongs to. */
export interface GroupableNode extends ReferenceNode {
  /** The definition a derived item belongs to; null for a source. */
  readonly definitionId: string | null
}

/**
 * One line of Site data in Layers. An analysis that published several outputs
 * into this Design gets a parent `analysis` line, its outputs nested under it;
 * a single output stays one `item` line under its source. `depth` is the
 * displayed nesting.
 */
export type SiteDataLine<T extends GroupableNode> =
  | { readonly kind: 'item'; readonly row: ReferenceRow<T>; readonly depth: number; readonly grouped: boolean }
  | {
      readonly kind: 'analysis'
      readonly definitionId: string
      /** The outputs in this Design, in list order. */
      readonly members: readonly ReferenceRow<T>[]
      readonly depth: number
    }

/**
 * Site data rows (front first, results after their source, as
 * `referenceRows` lists them) with the outputs of one analysis gathered under
 * an analysis line. Only siblings are gathered: outputs of one run always
 * share their source. Order among the outputs is kept, so moving a result
 * still moves it among its siblings.
 */
export function siteDataLines<T extends GroupableNode>(rows: readonly ReferenceRow<T>[]): SiteDataLine<T>[] {
  const lines: SiteDataLine<T>[] = []
  emitLevel(rows, 0, lines)
  return lines
}

interface Block<T extends GroupableNode> {
  readonly head: ReferenceRow<T>
  readonly descendants: readonly ReferenceRow<T>[]
}

/** Split one level of a pre-order list into each row and the rows under it. */
function blocksOf<T extends GroupableNode>(rows: readonly ReferenceRow<T>[]): Block<T>[] {
  const blocks: Block<T>[] = []
  let index = 0
  while (index < rows.length) {
    const head = rows[index]!
    let end = index + 1
    while (end < rows.length && rows[end]!.depth > head.depth) end += 1
    blocks.push({ head, descendants: rows.slice(index + 1, end) })
    index = end
  }
  return blocks
}

function emitLevel<T extends GroupableNode>(rows: readonly ReferenceRow<T>[], extraDepth: number, lines: SiteDataLine<T>[]): void {
  const blocks = blocksOf(rows)
  const counts = new Map<string, number>()
  for (const { head } of blocks) {
    if (head.definitionId) counts.set(head.definitionId, (counts.get(head.definitionId) ?? 0) + 1)
  }
  const emitted = new Set<string>()
  for (const block of blocks) {
    const definitionId = block.head.definitionId
    if (!definitionId || (counts.get(definitionId) ?? 0) < 2) {
      lines.push({ kind: 'item', row: block.head, depth: block.head.depth + extraDepth, grouped: false })
      emitLevel(block.descendants, extraDepth, lines)
      continue
    }
    if (emitted.has(definitionId)) continue
    emitted.add(definitionId)
    const members = blocks.filter((candidate) => candidate.head.definitionId === definitionId)
    lines.push({
      kind: 'analysis',
      definitionId,
      members: members.map((member) => member.head),
      depth: block.head.depth + extraDepth,
    })
    for (const member of members) {
      lines.push({ kind: 'item', row: member.head, depth: member.head.depth + extraDepth + 1, grouped: true })
      emitLevel(member.descendants, extraDepth + 1, lines)
    }
  }
}
