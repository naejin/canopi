import Konva from 'konva'
import { minimapVisible } from '../state/canvas'
import { getStratumColor } from './plants'

// ---------------------------------------------------------------------------
// Minimap — HTML <canvas> element rendered in screen space (not Konva)
// Shows a simplified overview of all content layers + a viewport rectangle.
// ---------------------------------------------------------------------------

const MINIMAP_W = 200
const MINIMAP_H = 150
const MINIMAP_PADDING = 10
const VIEWPORT_STROKE = 'rgba(45, 95, 63, 0.8)'
const VIEWPORT_FILL = 'rgba(45, 95, 63, 0.1)'
const ZONE_FILL = 'rgba(45, 95, 63, 0.25)'
const ZONE_STROKE = 'rgba(45, 95, 63, 0.5)'
const BG_COLOR = 'rgba(255, 255, 255, 0.85)'
const BORDER_COLOR = 'rgba(0, 0, 0, 0.15)'

export interface Minimap {
  canvas: HTMLCanvasElement
  update(stage: Konva.Stage, layers: Map<string, Konva.Layer>): void
  destroy(): void
}

export function createMinimap(
  container: HTMLElement,
  stage: Konva.Stage,
  layers: Map<string, Konva.Layer>,
): Minimap {
  const canvas = document.createElement('canvas')
  canvas.width = MINIMAP_W * (window.devicePixelRatio || 1)
  canvas.height = MINIMAP_H * (window.devicePixelRatio || 1)
  canvas.style.cssText = `
    position: absolute;
    bottom: 8px;
    right: 8px;
    width: ${MINIMAP_W}px;
    height: ${MINIMAP_H}px;
    z-index: 14;
    border-radius: 4px;
    border: 1px solid ${BORDER_COLOR};
    pointer-events: auto;
    cursor: pointer;
    display: ${minimapVisible.value ? 'block' : 'none'};
  `
  container.appendChild(canvas)

  // Click/drag on minimap to navigate
  let dragging = false
  const navigate = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect()
    const mx = (e.clientX - rect.left) / rect.width
    const my = (e.clientY - rect.top) / rect.height

    const bounds = _getContentBounds(layers)
    if (!bounds) return

    const worldX = bounds.x + mx * bounds.width
    const worldY = bounds.y + my * bounds.height

    const scale = stage.scaleX()
    stage.position({
      x: -worldX * scale + stage.width() / 2,
      y: -worldY * scale + stage.height() / 2,
    })
    stage.batchDraw()
  }

  canvas.addEventListener('mousedown', (e) => {
    dragging = true
    navigate(e)
  })
  canvas.addEventListener('mousemove', (e) => {
    if (dragging) navigate(e)
  })
  const onMouseUp = () => { dragging = false }
  document.addEventListener('mouseup', onMouseUp)

  function update(stg: Konva.Stage, lyrs: Map<string, Konva.Layer>): void {
    if (!minimapVisible.value) {
      canvas.style.display = 'none'
      return
    }
    canvas.style.display = 'block'
    _render(canvas, stg, lyrs)
  }

  function destroy(): void {
    document.removeEventListener('mouseup', onMouseUp)
    canvas.remove()
  }

  return { canvas, update, destroy }
}

// ---------------------------------------------------------------------------
// Internal rendering
// ---------------------------------------------------------------------------

function _getContentBounds(
  layers: Map<string, Konva.Layer>,
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  for (const [name, layer] of layers) {
    if (name === 'base' || name === 'ui') continue
    if (!layer.visible()) continue

    layer.getChildren().forEach((node) => {
      const r = node.getClientRect({ relativeTo: layer })
      if (r.width === 0 && r.height === 0) return
      minX = Math.min(minX, r.x)
      minY = Math.min(minY, r.y)
      maxX = Math.max(maxX, r.x + r.width)
      maxY = Math.max(maxY, r.y + r.height)
    })
  }

  if (minX === Infinity) return null

  // Add padding
  const pad = 50
  return {
    x: minX - pad,
    y: minY - pad,
    width: (maxX - minX) + pad * 2,
    height: (maxY - minY) + pad * 2,
  }
}

function _render(
  canvas: HTMLCanvasElement,
  stage: Konva.Stage,
  layers: Map<string, Konva.Layer>,
): void {
  const dpr = window.devicePixelRatio || 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H)

  // Background
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H)

  const bounds = _getContentBounds(layers)
  if (!bounds) return

  // Scale to fit content in minimap
  const scaleX = (MINIMAP_W - MINIMAP_PADDING * 2) / bounds.width
  const scaleY = (MINIMAP_H - MINIMAP_PADDING * 2) / bounds.height
  const scale = Math.min(scaleX, scaleY)
  const offsetX = MINIMAP_PADDING + ((MINIMAP_W - MINIMAP_PADDING * 2) - bounds.width * scale) / 2
  const offsetY = MINIMAP_PADDING + ((MINIMAP_H - MINIMAP_PADDING * 2) - bounds.height * scale) / 2

  const toMiniX = (wx: number) => offsetX + (wx - bounds.x) * scale
  const toMiniY = (wy: number) => offsetY + (wy - bounds.y) * scale

  // Draw zones as filled rectangles
  const zonesLayer = layers.get('zones')
  if (zonesLayer?.visible()) {
    ctx.fillStyle = ZONE_FILL
    ctx.strokeStyle = ZONE_STROKE
    ctx.lineWidth = 1

    zonesLayer.find('.shape').forEach((node: Konva.Node) => {
      if (node.hasName('plant-group') || node.hasName('object-group')) return
      const r = node.getClientRect({ relativeTo: zonesLayer })
      ctx.fillRect(toMiniX(r.x), toMiniY(r.y), r.width * scale, r.height * scale)
      ctx.strokeRect(toMiniX(r.x), toMiniY(r.y), r.width * scale, r.height * scale)
    })
  }

  // Draw plants as colored dots
  const plantsLayer = layers.get('plants')
  if (plantsLayer?.visible()) {
    plantsLayer.find('.plant-group').forEach((node: Konva.Node) => {
      const g = node as Konva.Group
      const stratum = g.getAttr('data-stratum') as string || null
      ctx.fillStyle = getStratumColor(stratum)
      const x = toMiniX(g.x())
      const y = toMiniY(g.y())
      ctx.beginPath()
      ctx.arc(x, y, 2, 0, Math.PI * 2)
      ctx.fill()
    })
  }

  // Draw viewport rectangle
  const stageScale = stage.scaleX()
  const stagePos = stage.position()
  const vpLeft = -stagePos.x / stageScale
  const vpTop = -stagePos.y / stageScale
  const vpWidth = stage.width() / stageScale
  const vpHeight = stage.height() / stageScale

  ctx.strokeStyle = VIEWPORT_STROKE
  ctx.fillStyle = VIEWPORT_FILL
  ctx.lineWidth = 1.5
  const rx = toMiniX(vpLeft)
  const ry = toMiniY(vpTop)
  const rw = vpWidth * scale
  const rh = vpHeight * scale
  ctx.fillRect(rx, ry, rw, rh)
  ctx.strokeRect(rx, ry, rw, rh)
}
