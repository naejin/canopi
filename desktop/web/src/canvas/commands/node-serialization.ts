import Konva from 'konva'

// Ephemeral attrs set by tools (hover/selection highlights) that must never
// be persisted in commands or saved to disk.
const EPHEMERAL_ATTRS = new Set([
  'shadowColor', 'shadowBlur', 'shadowOpacity', 'shadowForStrokeEnabled',
  'data-highlight', 'data-orig-stroke', 'data-orig-strokeWidth',
])

export interface SerializedNode {
  className: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attrs: Record<string, any>
  // Children are preserved for Group nodes (e.g. plant groups)
  children?: SerializedNode[]
}

export function serializeNode(node: Konva.Node): SerializedNode {
  const raw = node.getAttrs() as Record<string, unknown>
  const attrs: Record<string, unknown> = {}
  for (const key of Object.keys(raw)) {
    if (!EPHEMERAL_ATTRS.has(key)) {
      attrs[key] = raw[key]
    }
  }

  const base: SerializedNode = {
    className: node.getClassName(),
    attrs,
  }

  // Recursively serialize children for Group nodes
  if (node instanceof Konva.Group) {
    base.children = node.getChildren().map((child) => serializeNode(child as Konva.Node))
  }

  return base
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function recreateNode(data: SerializedNode): Konva.Node {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = data.attrs as any

  if (data.className === 'Group') {
    const group = new Konva.Group(a)
    if (data.children) {
      for (const childData of data.children) {
        group.add(recreateNode(childData) as Konva.Shape)
      }
    }
    return group
  }

  switch (data.className) {
    case 'Rect':    return new Konva.Rect(a)
    case 'Ellipse': return new Konva.Ellipse(a)
    case 'Line':    return new Konva.Line(a)
    case 'Text':    return new Konva.Text(a)
    case 'Circle':  return new Konva.Circle(a)
    case 'Arrow':   return new Konva.Arrow(a)
    default:        return new Konva.Shape(a)
  }
}
