import type { CameraController } from '../camera'
import type { ScenePersistedState, ScenePlantEntity, ScenePoint } from '../scene'
import { formatMetricDistance } from '../zone-measurements'

const SVG_NS = 'http://www.w3.org/2000/svg'
const MAX_DISTANCE_GUIDES = 3

export interface PlantDragDistanceOverlayController {
  update(options: {
    scene: ScenePersistedState
    activePlantId: string | null
    draggedPlantIds: ReadonlySet<string>
    camera: CameraController
  }): void
  hide(): void
  dispose(): void
}

interface PlantDistanceGuide {
  readonly plant: ScenePlantEntity
  readonly distance: number
}

export function createPlantDragDistanceOverlay(container: HTMLElement): PlantDragDistanceOverlayController {
  const root = document.createElement('div')
  root.dataset.plantDragDistanceOverlay = 'true'
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    display: 'none',
    zIndex: '5',
  })

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  Object.assign(svg.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    overflow: 'visible',
  })
  root.appendChild(svg)
  container.appendChild(root)

  return {
    update({ scene, activePlantId, draggedPlantIds, camera }) {
      svg.replaceChildren()
      for (const label of root.querySelectorAll('[data-plant-drag-distance-label]')) label.remove()

      if (!activePlantId || !isPlantLayerVisible(scene)) {
        root.style.display = 'none'
        return
      }

      const activePlant = scene.plants.find((plant) => plant.id === activePlantId)
      if (!activePlant || !draggedPlantIds.has(activePlant.id)) {
        root.style.display = 'none'
        return
      }

      const guides = nearestDistanceGuides(scene.plants, activePlant, draggedPlantIds)
      if (guides.length === 0) {
        root.style.display = 'none'
        return
      }

      const activeScreen = camera.worldToScreen(activePlant.position)
      for (const guide of guides) {
        const neighborScreen = camera.worldToScreen(guide.plant.position)
        appendGuide(svg, root, activeScreen, neighborScreen, formatMetricDistance(guide.distance))
      }

      root.style.display = 'block'
    },
    hide() {
      svg.replaceChildren()
      for (const label of root.querySelectorAll('[data-plant-drag-distance-label]')) label.remove()
      root.style.display = 'none'
    },
    dispose() {
      root.remove()
    },
  }
}

function nearestDistanceGuides(
  plants: readonly ScenePlantEntity[],
  activePlant: ScenePlantEntity,
  draggedPlantIds: ReadonlySet<string>,
): PlantDistanceGuide[] {
  return plants
    .filter((plant) => !draggedPlantIds.has(plant.id))
    .map((plant) => ({
      plant,
      distance: distance(activePlant.position, plant.position),
    }))
    .sort((left, right) => left.distance - right.distance || left.plant.id.localeCompare(right.plant.id))
    .slice(0, MAX_DISTANCE_GUIDES)
}

function appendGuide(
  svg: SVGSVGElement,
  root: HTMLElement,
  start: ScenePoint,
  end: ScenePoint,
  text: string,
): void {
  const line = document.createElementNS(SVG_NS, 'line')
  line.dataset.plantDragDistanceLine = 'true'
  line.setAttribute('x1', String(start.x))
  line.setAttribute('y1', String(start.y))
  line.setAttribute('x2', String(end.x))
  line.setAttribute('y2', String(end.y))
  line.setAttribute('stroke', 'var(--color-overlay-band-border)')
  line.setAttribute('stroke-width', '1.5')
  line.setAttribute('stroke-dasharray', '4 4')
  line.setAttribute('stroke-linecap', 'round')
  svg.appendChild(line)

  const midpoint = {
    x: start.x + (end.x - start.x) / 2,
    y: start.y + (end.y - start.y) / 2,
  }
  const label = document.createElement('div')
  label.dataset.plantDragDistanceLabel = 'true'
  label.textContent = text
  Object.assign(label.style, {
    position: 'absolute',
    left: `${midpoint.x}px`,
    top: `${midpoint.y}px`,
    transform: 'translate(-50%, -50%)',
    padding: '2px 5px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border-strong)',
    background: 'var(--color-surface-muted)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-xs)',
    fontWeight: '600',
    lineHeight: '1.2',
    whiteSpace: 'nowrap',
    boxShadow: 'var(--shadow-sm)',
  })
  root.appendChild(label)
}

function isPlantLayerVisible(scene: ScenePersistedState): boolean {
  return scene.layers.find((layer) => layer.name === 'plants')?.visible !== false
}

function distance(left: ScenePoint, right: ScenePoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y)
}
