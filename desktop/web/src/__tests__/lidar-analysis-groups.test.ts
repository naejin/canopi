import { describe, expect, it } from 'vitest'
import { siteDataLines } from '../app/lidar/analysis-groups'
import { referenceRows } from '../app/lidar/reference-tree'

interface Node {
  readonly id: string
  readonly order: number
  readonly parentId: string | null
  readonly definitionId: string | null
}

const node = (id: string, order: number, parentId: string | null = null, definitionId: string | null = null): Node =>
  ({ id, order, parentId, definitionId })

function outline(nodes: readonly Node[]): string[] {
  return siteDataLines(referenceRows(nodes)).map((line) =>
    `${'  '.repeat(line.depth)}${line.kind === 'analysis' ? `[${line.definitionId}: ${line.members.map((member) => member.id).join(', ')}]` : line.row.id}`)
}

describe('Site data analysis groups', () => {
  it('leaves sources and single results as they are', () => {
    expect(outline([node('dem', 0), node('slope', 1, 'dem', 'slope-def'), node('canopy', 2)]))
      .toEqual(['canopy', 'dem', '  slope'])
  })

  it('gathers the outputs of one definition under one analysis line, in list order', () => {
    expect(outline([
      node('dem', 0),
      node('flow-direction', 3, 'dem', 'flow'),
      node('slope', 2, 'dem', 'slope-def'),
      node('flow-accumulation', 1, 'dem', 'flow'),
    ])).toEqual([
      'dem',
      '  [flow: flow-direction, flow-accumulation]',
      '    flow-direction',
      '    flow-accumulation',
      '  slope',
    ])
  })

  it('keeps results of an output nested under it, one level deeper', () => {
    expect(outline([
      node('dem', 0),
      node('a', 2, 'dem', 'flow'),
      node('b', 1, 'dem', 'flow'),
      node('a-derived', 0, 'a', 'next'),
    ])).toEqual([
      'dem',
      '  [flow: a, b]',
      '    a',
      '      a-derived',
      '    b',
    ])
  })

  it('groups top-level outputs whose source is not in the Design', () => {
    expect(outline([node('a', 1, 'gone', 'flow'), node('b', 0, 'gone', 'flow')]))
      .toEqual(['[flow: a, b]', '  a', '  b'])
  })
})
