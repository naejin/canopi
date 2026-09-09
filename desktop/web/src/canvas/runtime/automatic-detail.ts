import { getAnnotationWorldBounds } from './annotation-layout'
import { LabelCollisionIndex, type LabelBounds } from '../label-collision'
import { getPlantWorldBounds } from './plant-presentation'
import { nearestPlantSpacing } from '../plant-spacing'
import { createMeasurementGuidePresentation, MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX } from './measurement-guides'
import type { ScenePersistedState } from './scene'
import { getSceneLayerStyle } from './scene-visuals'
import { getCanvasTextOpacity } from './text-visibility'
import type { SceneRendererSnapshot } from './renderers/scene-types'
import type { PlantNameLabel } from './selection-labels'

export function getCanvasPlantNameLabels(snapshot: SceneRendererSnapshot): readonly PlantNameLabel[] {
  const { scene, viewport } = snapshot
  const layer = getSceneLayerStyle(scene, 'plants')
  if (!layer.visible || layer.opacity === 0) return []
  if (viewport.scale < 100 && snapshot.pinnedPlantNameLabels.length === 0) return []
  const occupied = new LabelCollisionIndex()
  for (const rect of getCanvasDetailLayout(scene, viewport.scale).bounds) occupied.add(rect)
  for (const label of snapshot.selectionLabels) {
    occupied.add(nameBounds(label.text, label.screenPoint.x - viewport.x, label.screenPoint.y - viewport.y))
  }
  const pinned = new Map(snapshot.pinnedPlantNameLabels.map((label) => [label.plantId, label]))
  const hoveredId = snapshot.hoverTarget?.kind === 'plant' ? snapshot.hoverTarget.id : null
  const plants = [...scene.plants].sort((a, b) =>
    Number(b.id === hoveredId) - Number(a.id === hoveredId) || Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || a.id.localeCompare(b.id))
  const result: PlantNameLabel[] = []
  const context = { plants: scene.plants, viewport, speciesCache: snapshot.speciesCache }
  for (const plant of plants) {
    const existing = pinned.get(plant.id)
    if (snapshot.selectionLabelPlantIds.has(plant.id) && !plant.pinnedName) continue
    const forced = snapshot.selectionLabelPlantIds.has(plant.id)
    if (!existing && !plant.pinnedName && !forced && (viewport.scale < 100 || nearestPlantSpacing(scene.plants, plant.position) * viewport.scale < 35)) continue
    const opacity = forced ? 1 : existing?.opacity ?? getCanvasTextOpacity(viewport.scale)
    if (!opacity) continue
    const commonName = snapshot.localizedCommonNames.get(plant.canonicalName) ?? plant.commonName
    const text = existing?.text ?? (commonName || plant.canonicalName)
    const fontStyle = existing?.fontStyle ?? (commonName ? 'normal' : 'italic')
    const radius = getPlantWorldBounds(plant, context).width * viewport.scale / 2
    const x = plant.position.x * viewport.scale, y = plant.position.y * viewport.scale
    const candidates = [nameBounds(text, x, y + radius + 4), nameBounds(text, x, y - radius - 20)]
    const rect = candidates.find((candidate) => !occupied.overlaps(candidate)) ?? (forced ? candidates[0] : null)
    if (!rect) continue
    occupied.add(rect)
    result.push({ plantId: plant.id, text, fontStyle, opacity, screenPoint: { x: x + viewport.x, y: rect.y + 2 + viewport.y } })
  }
  return result
}

function nameBounds(text: string, x: number, y: number): LabelBounds {
  const width = Array.from(text).reduce((sum, character) => sum + (character.codePointAt(0)! > 0x2ff ? 12 : 8.4), 0)
  return { x: x - width / 2 - 2, y: y - 2, width: width + 4, height: 19 }
}

interface CanvasDetailLayout {
  readonly annotationIds: ReadonlySet<string>
  readonly measurementIds: ReadonlySet<string>
  readonly bounds: readonly LabelBounds[]
}

export function isMeasurementLabelVisible(snapshot: SceneRendererSnapshot, id: string): boolean {
  return snapshot.selectedMeasurementGuideIds.has(id)
    || (snapshot.hoverTarget?.kind === 'measurement-guide' && snapshot.hoverTarget.id === id)
    || getCanvasDetailLayout(snapshot.scene, snapshot.viewport.scale).measurementIds.has(id)
}

// Pan does not affect admission. Keep the main view and an inspection view warm.
const layouts = new WeakMap<ScenePersistedState, Map<number, CanvasDetailLayout>>()

export function getCanvasDetailLayout(scene: ScenePersistedState, scale: number): CanvasDetailLayout {
  let cache = layouts.get(scene)
  const previous = cache?.get(scale)
  if (previous) return previous
  const occupied = new LabelCollisionIndex()
  const bounds: LabelBounds[] = []
  function reserve(rect: LabelBounds) { occupied.add(rect); bounds.push(rect) }
  const annotationIds = new Set<string>()
  const measurementIds = new Set<string>()
  const context = { plants: scene.plants, viewport: { x: 0, y: 0, scale }, speciesCache: new Map() }
  if (isLayerVisible(scene, 'plants')) for (const plant of scene.plants) {
    const bounds = getPlantWorldBounds(plant, context)
    reserve({ x: bounds.x * scale - 2, y: bounds.y * scale - 2, width: bounds.width * scale + 4, height: bounds.height * scale + 4 })
  }
  if (isLayerVisible(scene, 'annotations') && getCanvasTextOpacity(scale) > 0) {
    for (const annotation of [...scene.annotations].reverse()) {
      const world = getAnnotationWorldBounds(annotation, scale)
      const rect = { x: world.x * scale - 2, y: world.y * scale - 2, width: world.width * scale + 4, height: world.height * scale + 4 }
      if (occupied.overlaps(rect)) continue
      annotationIds.add(annotation.id)
      reserve(rect)
    }
  }
  if (isLayerVisible(scene, 'measurement-guides')) for (const guide of scene.measurementGuides) {
    const presentation = createMeasurementGuidePresentation(guide, { x: 0, y: 0, scale })
    if (!presentation) continue
    const w = presentation.text.length * MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX * .7 + 4
    if (presentation.lengthWorld * scale < w + 16) continue
    const h = MEASUREMENT_GUIDE_LABEL_FONT_SIZE_PX + 4
    const cos = Math.abs(Math.cos(presentation.labelRotationRad)), sin = Math.abs(Math.sin(presentation.labelRotationRad))
    const width = w * cos + h * sin, height = w * sin + h * cos
    const rect = { x: presentation.labelScreenPoint.x - width / 2, y: presentation.labelScreenPoint.y - height / 2, width, height }
    if (occupied.overlaps(rect)) continue
    measurementIds.add(guide.id)
    reserve(rect)
  }
  const result = { annotationIds, measurementIds, bounds }
  if (!cache) { cache = new Map(); layouts.set(scene, cache) }
  if (cache.size >= 2) cache.delete(cache.keys().next().value!)
  cache.set(scale, result)
  return result
}

function isLayerVisible(scene: ScenePersistedState, name: string): boolean {
  const layer = getSceneLayerStyle(scene, name)
  return layer.visible && layer.opacity > 0
}
