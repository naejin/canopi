import Konva from 'konva'
import type { CanvasEngine } from './engine'

// ---------------------------------------------------------------------------
// PNG export
// ---------------------------------------------------------------------------

/**
 * Export the visible canvas as a PNG Blob.
 * pixelRatio defaults to 2 for retina-quality output.
 */
export async function exportPNG(
  engine: CanvasEngine,
  options: { pixelRatio?: number } = {},
): Promise<Blob> {
  const pixelRatio = options.pixelRatio ?? 2
  const dataURL = engine.stage.toDataURL({ pixelRatio, mimeType: 'image/png' })
  const response = await fetch(dataURL)
  return response.blob()
}

// ---------------------------------------------------------------------------
// SVG export
// ---------------------------------------------------------------------------

/**
 * Export visible canvas layers as an SVG string.
 * The 'base' layer (grid/background) and UI/ruler overlays are excluded.
 */
export function exportSVG(engine: CanvasEngine): string {
  const stage = engine.stage
  const width = stage.width()
  const height = stage.height()

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`
  svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n`

  const SKIP_LAYERS = new Set(['base', 'ui'])

  for (const [name, layer] of engine.layers) {
    if (!layer.visible()) continue
    if (SKIP_LAYERS.has(name)) continue

    svg += `  <g id="${escapeXmlAttr(name)}">\n`
    layer.getChildren().forEach((node: Konva.Node) => {
      svg += nodeToSVG(node, '    ')
    })
    svg += `  </g>\n`
  }

  svg += `</svg>`
  return svg
}

function nodeToSVG(node: Konva.Node, indent: string): string {
  const className = node.getClassName()

  switch (className) {
    case 'Rect': {
      const r = node as Konva.Rect
      const opacity = r.opacity() !== 1 ? ` opacity="${r.opacity()}"` : ''
      return (
        `${indent}<rect x="${r.x()}" y="${r.y()}" ` +
        `width="${r.width()}" height="${r.height()}" ` +
        `fill="${r.fill() || 'none'}" stroke="${r.stroke() || 'none'}" ` +
        `stroke-width="${r.strokeWidth() || 0}"${opacity} />\n`
      )
    }
    case 'Ellipse': {
      const e = node as Konva.Ellipse
      const opacity = e.opacity() !== 1 ? ` opacity="${e.opacity()}"` : ''
      return (
        `${indent}<ellipse cx="${e.x()}" cy="${e.y()}" ` +
        `rx="${e.radiusX()}" ry="${e.radiusY()}" ` +
        `fill="${e.fill() || 'none'}" stroke="${e.stroke() || 'none'}" ` +
        `stroke-width="${e.strokeWidth() || 0}"${opacity} />\n`
      )
    }
    case 'Circle': {
      const c = node as Konva.Circle
      const opacity = c.opacity() !== 1 ? ` opacity="${c.opacity()}"` : ''
      return (
        `${indent}<circle cx="${c.x()}" cy="${c.y()}" r="${c.radius()}" ` +
        `fill="${c.fill() || 'none'}" stroke="${c.stroke() || 'none'}" ` +
        `stroke-width="${c.strokeWidth() || 0}"${opacity} />\n`
      )
    }
    case 'Line': {
      const l = node as Konva.Line
      const pts = l.points()
      if (pts.length < 4) return ''
      const pointStr: string[] = []
      for (let i = 0; i < pts.length; i += 2) {
        pointStr.push(`${pts[i]! + l.x()},${pts[i + 1]! + l.y()}`)
      }
      const opacity = l.opacity() !== 1 ? ` opacity="${l.opacity()}"` : ''
      if (l.closed()) {
        return (
          `${indent}<polygon points="${pointStr.join(' ')}" ` +
          `fill="${l.fill() || 'none'}" stroke="${l.stroke() || 'none'}" ` +
          `stroke-width="${l.strokeWidth() || 0}"${opacity} />\n`
        )
      } else {
        return (
          `${indent}<polyline points="${pointStr.join(' ')}" fill="none" ` +
          `stroke="${l.stroke() || 'none'}" stroke-width="${l.strokeWidth() || 0}"${opacity} />\n`
        )
      }
    }
    case 'Text': {
      const tx = node as Konva.Text
      const opacity = tx.opacity() !== 1 ? ` opacity="${tx.opacity()}"` : ''
      return (
        `${indent}<text x="${tx.x()}" y="${tx.y()}" ` +
        `font-size="${tx.fontSize()}" font-family="${escapeXmlAttr(tx.fontFamily())}" ` +
        `fill="${tx.fill() || '#000'}"${opacity}>${escapeXmlContent(tx.text())}</text>\n`
      )
    }
    case 'Group': {
      const g = node as Konva.Group
      const transform = `translate(${g.x()},${g.y()})`
      const opacity = g.opacity() !== 1 ? ` opacity="${g.opacity()}"` : ''
      let result = `${indent}<g transform="${transform}"${opacity}>\n`
      g.getChildren().forEach((child: Konva.Node) => {
        result += nodeToSVG(child, indent + '  ')
      })
      result += `${indent}</g>\n`
      return result
    }
    default:
      return ''
  }
}

function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeXmlContent(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

/**
 * Export all placed plants as a CSV string with columns:
 * canonical_name, common_name, x, y, rotation, quantity
 */
export function exportPlantCSV(engine: CanvasEngine): string {
  const plantsLayer = engine.layers.get('plants')
  if (!plantsLayer) return 'canonical_name,common_name,x,y,rotation,quantity\n'

  const rows: string[] = ['canonical_name,common_name,x,y,rotation,quantity']

  plantsLayer.find('.plant-group').forEach((node: Konva.Node) => {
    const group = node as Konva.Group
    const name = (group.getAttr('data-canonical-name') as string | undefined) ?? ''
    const common = (group.getAttr('data-common-name') as string | undefined) ?? ''
    const x = group.x().toFixed(2)
    const y = group.y().toFixed(2)
    const rotation = (group.rotation() || 0).toFixed(1)
    rows.push(`${csvEscape(name)},${csvEscape(common)},${x},${y},${rotation},1`)
  })

  return rows.join('\n')
}

function csvEscape(str: string): string {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

// TODO(Phase 3): Add PDF export via a headless Chromium/WebKit renderer (Tauri
// shell command) — print canvas as vector PDF with legend and plant list.

// TODO(Phase 3): Add georeferenced GeoJSON/KML export once the MapLibre layer
// is wired up and world coordinates are mapped to canvas space.
