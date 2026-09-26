import type { WorkspaceCameraFrameReader } from '../camera'
import type { ScenePoint } from '../scene'

const SVG_NS = 'http://www.w3.org/2000/svg'
const DRAFT_LINE_PX = 2

export interface PolygonDraftOverlayController {
  update(vertices: readonly ScenePoint[], activePoint: ScenePoint | null, camera: WorkspaceCameraFrameReader): void
  hide(): void
  dispose(): void
}

export function createPolygonDraftOverlay(container: HTMLElement): PolygonDraftOverlayController {
  const root = document.createElementNS(SVG_NS, 'svg')
  root.dataset.polygonDraftOverlay = 'true'
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    display: 'none',
    zIndex: '3',
    overflow: 'visible',
  })
  container.appendChild(root)

  return {
    update(vertices, activePoint, camera) {
      root.replaceChildren()
      if (vertices.length === 0) {
        root.style.display = 'none'
        return
      }

      const committedPoints = vertices.map((point) => camera.worldToScreen(point))
      if (committedPoints.length >= 3) {
        const fill = document.createElementNS(SVG_NS, 'polygon')
        fill.dataset.polygonDraftFill = 'true'
        fill.setAttribute('points', formatSvgPoints(committedPoints))
        fill.setAttribute('fill', 'var(--canvas-zone-fill)')
        fill.setAttribute('stroke', 'none')
        root.appendChild(fill)
      }

      const activeScreen = activePoint ? camera.worldToScreen(activePoint) : null
      const linePoints = activeScreen ? [...committedPoints, activeScreen] : committedPoints
      if (linePoints.length >= 2) {
        // Dark casing first so the light draft line reads on any imagery.
        const points = formatSvgPoints(linePoints)
        root.appendChild(createDraftPolyline(points, 'var(--canvas-overlay-casing)', DRAFT_LINE_PX + 2))
        const line = createDraftPolyline(points, 'var(--canvas-guide-line)', DRAFT_LINE_PX)
        line.dataset.polygonDraftLine = 'true'
        root.appendChild(line)
      }

      for (const point of committedPoints) {
        const marker = document.createElementNS(SVG_NS, 'circle')
        marker.dataset.polygonDraftVertex = 'true'
        marker.setAttribute('cx', formatSvgNumber(point.x))
        marker.setAttribute('cy', formatSvgNumber(point.y))
        marker.setAttribute('r', '3.5')
        marker.setAttribute('fill', 'var(--canvas-guide-line)')
        marker.setAttribute('stroke', 'var(--canvas-overlay-casing)')
        marker.setAttribute('stroke-width', '1.5')
        root.appendChild(marker)
      }

      root.style.display = 'block'
    },
    hide() {
      root.replaceChildren()
      root.style.display = 'none'
    },
    dispose() {
      root.remove()
    },
  }
}

function createDraftPolyline(points: string, stroke: string, width: number): SVGPolylineElement {
  const line = document.createElementNS(SVG_NS, 'polyline')
  line.setAttribute('points', points)
  line.setAttribute('fill', 'none')
  line.setAttribute('stroke', stroke)
  line.setAttribute('stroke-width', String(width))
  line.setAttribute('stroke-linejoin', 'round')
  line.setAttribute('stroke-linecap', 'round')
  return line
}

function formatSvgPoints(points: readonly ScenePoint[]): string {
  return points.map((point) => `${formatSvgNumber(point.x)},${formatSvgNumber(point.y)}`).join(' ')
}

function formatSvgNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
