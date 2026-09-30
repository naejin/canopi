import type { PlantStampSource } from '../../plant-stamp-source'
import type { CanvasRuntimeTranslator } from '../app-adapter'
import type { WorkspaceCameraFrameReader } from '../camera'
import type { PlantPresentationContext } from '../plant-presentation'
import type { ScenePersistedState, ScenePlantEntity, ScenePoint } from '../scene'
import { formatMetricDistance } from '../zone-measurements'
import { appendDistanceGuide } from './plant-drag-distance-overlay'
import { appendPlantSymbolGhost } from './saved-object-stamp-tool'
import { plantEntityFromStampSource } from '../tools/tool-actions'

const SVG_NS = 'http://www.w3.org/2000/svg'
/** Previews draw the real symbol size at 85% opacity. */
const PREVIEW_OPACITY = 0.85
/** A neighbour further than this on screen is not worth a line across the map. */
const NEAREST_PLANT_MAX_SCREEN_PX = 320
const PREVIEW_PLANT_ID = 'plant-placement-preview'

interface PlantPlacementPreviewInput {
  readonly source: PlantStampSource
  readonly world: ScenePoint
  readonly scene: ScenePersistedState
  readonly camera: WorkspaceCameraFrameReader
  readonly plantContext: PlantPresentationContext
  readonly commonNames: ReadonlyMap<string, string | null>
}

export interface PlantPlacementPreviewController {
  show(input: PlantPlacementPreviewInput): void
  hide(): void
  dispose(): void
}

/**
 * Place plants' hover preview, read-only: the species' symbol where a click
 * would place it, a dashed ring for its mature width when the catalog gives
 * one (never invented), and the distance to the nearest plant on screen.
 */
export function createPlantPlacementPreview(
  container: HTMLElement,
  translate: CanvasRuntimeTranslator,
): PlantPlacementPreviewController {
  const root = document.createElement('div')
  root.dataset.plantPlacementPreview = 'true'
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    display: 'none',
    zIndex: '5',
  })
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible' })
  root.appendChild(svg)
  container.appendChild(root)

  function clear(): void {
    svg.replaceChildren()
    for (const label of [...root.children]) if (label !== svg) label.remove()
  }

  return {
    show({ source, world, scene, camera, plantContext, commonNames }) {
      clear()
      const center = camera.worldToScreen(world)
      const width = source.width_max_m
      if (width !== null && Number.isFinite(width) && width > 0) {
        const radius = (width / 2) * camera.viewport.scale
        appendSpreadRing(svg, center, radius)
        appendLabel(root, { x: center.x, y: center.y - radius }, translate('canvas.placePreview.matureWidth', {
          width: formatMetricDistance(width),
        }), 'mature-width')
      }

      const glyph = document.createElementNS(SVG_NS, 'g')
      glyph.dataset.plantPlacementGlyph = source.canonical_name
      const plant = plantEntityFromStampSource(scene, source, world, PREVIEW_PLANT_ID)
      const glyphRadius = appendPlantSymbolGhost(glyph, camera, plant, plantContext, PREVIEW_OPACITY)

      const nearest = nearestPlant(scene, world)
      if (nearest) {
        const neighbour = camera.worldToScreen(nearest.plant.position)
        if (Math.hypot(neighbour.x - center.x, neighbour.y - center.y) <= NEAREST_PLANT_MAX_SCREEN_PX) {
          const name = commonNames.get(nearest.plant.canonicalName) ?? nearest.plant.commonName ?? nearest.plant.canonicalName
          // Below the symbol, so a close neighbour's label never hides it.
          const labelAt = { x: center.x, y: center.y + Math.max(glyphRadius ?? 0, 6) + 16 }
          appendDistanceGuide(svg, root, center, neighbour, translate('canvas.placePreview.nearest', {
            distance: formatMetricDistance(nearest.distance),
            name,
          }), 'plantPlacementNearest', labelAt)
        }
      }

      // Last, so the symbol draws over the distance line.
      if (glyphRadius !== null) svg.appendChild(glyph)
      root.style.display = 'block'
    },
    hide() {
      clear()
      root.style.display = 'none'
    },
    dispose() {
      root.remove()
    },
  }
}

function nearestPlant(
  scene: ScenePersistedState,
  world: ScenePoint,
): { readonly plant: ScenePlantEntity, readonly distance: number } | null {
  if (scene.layers.find((layer) => layer.name === 'plants')?.visible === false) return null
  let best: { plant: ScenePlantEntity, distance: number } | null = null
  for (const plant of scene.plants) {
    const distance = Math.hypot(plant.position.x - world.x, plant.position.y - world.y)
    if (!best || distance < best.distance) best = { plant, distance }
  }
  return best
}

function appendSpreadRing(svg: SVGSVGElement, center: ScenePoint, radius: number): void {
  // Dark casing under the light dashed ring so it reads on any imagery.
  for (const [stroke, width] of [['var(--canvas-overlay-casing)', 3.5], ['var(--canvas-guide-line)', 1.5]] as const) {
    const circle = document.createElementNS(SVG_NS, 'circle')
    circle.setAttribute('cx', String(center.x))
    circle.setAttribute('cy', String(center.y))
    circle.setAttribute('r', String(radius))
    circle.setAttribute('fill', 'none')
    circle.setAttribute('stroke', stroke)
    circle.setAttribute('stroke-width', String(width))
    circle.setAttribute('stroke-dasharray', '6 5')
    if (stroke === 'var(--canvas-guide-line)') circle.dataset.plantPlacementSpread = String(radius)
    svg.appendChild(circle)
  }
}

function appendLabel(root: HTMLElement, at: ScenePoint, text: string, kind: string): void {
  const label = document.createElement('div')
  label.dataset.plantPlacementLabel = kind
  label.textContent = text
  Object.assign(label.style, {
    position: 'absolute',
    left: `${at.x}px`,
    top: `${at.y}px`,
    transform: 'translate(-50%, calc(-100% - 4px))',
    padding: '2px 6px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border-strong)',
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontSize: 'var(--text-xs)',
    fontWeight: '600',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    boxShadow: 'var(--shadow-sm)',
  })
  root.appendChild(label)
}
