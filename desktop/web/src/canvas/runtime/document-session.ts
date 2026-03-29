import Konva from 'konva'
import { locale } from '../../state/app'
import {
  activeTool,
  createDefaultLayerLockState,
  createDefaultLayerOpacity,
  createDefaultLayerVisibility,
  currentConsortiums,
  designLocation,
  guides,
  highlightedConsortium,
  layerLockState,
  layerOpacity,
  layerVisibility,
  lockedObjectIds,
  northBearingDeg,
  selectedObjectIds,
} from '../../state/canvas'
import type { CanopiFile } from '../../types/design'
import { createPlantNode, updatePlantLabelsForLocale } from '../plants'
import type { Guide } from '../guides'
import { getCanvasColor, isThemeManagedZoneFill } from '../theme-refresh'
import type { DocumentSessionEngine } from './types'

const CONTENT_LAYERS = ['contours', 'climate', 'zones', 'water', 'plants', 'annotations'] as const
const LAYER_NAMES = ['base', 'contours', 'climate', 'zones', 'water', 'plants', 'annotations'] as const

export function resetTransientCanvasSession(): void {
  activeTool.value = 'select'
  selectedObjectIds.value = new Set()
  lockedObjectIds.value = new Set()
  highlightedConsortium.value = null
}

export function loadDocumentSession(file: CanopiFile, engine: DocumentSessionEngine): void {
  for (const name of CONTENT_LAYERS) {
    engine.layers.get(name)?.destroyChildren()
  }

  const plantsLayer = engine.layers.get('plants')
  if (plantsLayer) {
    for (const plant of file.plants) {
      const node = createPlantNode({
        id: plant.id || crypto.randomUUID(),
        canonicalName: plant.canonical_name,
        commonName: plant.common_name ?? null,
        stratum: null,
        canopySpreadM: plant.scale ?? null,
        position: plant.position,
        stageScale: engine.stage.scaleX(),
        notes: plant.notes,
        plantedDate: plant.planted_date,
        quantity: plant.quantity,
      })
      if (plant.rotation != null) node.rotation(plant.rotation)
      plantsLayer.add(node as unknown as Konva.Shape)
    }
  }

  const zonesLayer = engine.layers.get('zones')
  if (zonesLayer) {
    for (const zone of file.zones) {
      let shape: Konva.Shape | null = null

      if (zone.zone_type === 'rect' && zone.points.length >= 4) {
        const p0 = zone.points[0]!
        const p2 = zone.points[2]!
        const usesThemeFill = isThemeManagedZoneFill(zone.fill_color)
        shape = new Konva.Rect({
          id: zone.name,
          x: p0.x,
          y: p0.y,
          width: p2.x - p0.x,
          height: p2.y - p0.y,
          fill: usesThemeFill ? getCanvasColor('zone-fill') : (zone.fill_color ?? getCanvasColor('zone-fill')),
          stroke: getCanvasColor('zone-stroke'),
          strokeWidth: 2,
          strokeScaleEnabled: false,
          draggable: true,
          name: 'shape',
          'data-theme-managed-fill': usesThemeFill,
        })
      } else if (zone.zone_type === 'ellipse' && zone.points.length >= 2) {
        const center = zone.points[0]!
        const radii = zone.points[1]!
        const usesThemeFill = isThemeManagedZoneFill(zone.fill_color)
        shape = new Konva.Ellipse({
          id: zone.name,
          x: center.x,
          y: center.y,
          radiusX: radii.x,
          radiusY: radii.y,
          fill: usesThemeFill ? getCanvasColor('zone-fill') : (zone.fill_color ?? getCanvasColor('zone-fill')),
          stroke: getCanvasColor('zone-stroke'),
          strokeWidth: 2,
          strokeScaleEnabled: false,
          draggable: true,
          name: 'shape',
          'data-theme-managed-fill': usesThemeFill,
        })
      } else if (
        (zone.zone_type === 'line' || zone.zone_type === 'polygon' || zone.zone_type === 'freeform') &&
        zone.points.length >= 2
      ) {
        const pts: number[] = []
        for (const point of zone.points) {
          pts.push(point.x, point.y)
        }
        const closed = zone.zone_type !== 'line'
        const usesThemeFill = closed && isThemeManagedZoneFill(zone.fill_color)
        shape = new Konva.Line({
          id: zone.name,
          points: pts,
          closed,
          fill: closed
            ? (usesThemeFill ? getCanvasColor('zone-fill') : (zone.fill_color ?? getCanvasColor('zone-fill')))
            : undefined,
          stroke: getCanvasColor('zone-stroke'),
          strokeWidth: 2,
          strokeScaleEnabled: false,
          draggable: true,
          name: 'shape',
          'data-theme-managed-fill': usesThemeFill,
        })
      }

      if (!shape) continue
      shape.setAttr('data-notes', zone.notes ?? null)
      zonesLayer.add(shape)
    }
  }

  const vis = createDefaultLayerVisibility()
  const locks = createDefaultLayerLockState()
  const opacities = createDefaultLayerOpacity()
  for (const name of LAYER_NAMES) {
    const layer = engine.layers.get(name)
    if (layer) {
      layer.visible(vis[name])
      layer.opacity(opacities[name])
    }
  }
  for (const layerState of file.layers) {
    vis[layerState.name] = layerState.visible
    locks[layerState.name] = layerState.locked
    opacities[layerState.name] = layerState.opacity
    const layer = engine.layers.get(layerState.name)
    if (layer) {
      layer.visible(layerState.visible)
      layer.opacity(layerState.opacity)
    }
  }
  layerVisibility.value = vis
  layerLockState.value = locks
  layerOpacity.value = opacities

  if (file.groups && file.groups.length > 0) {
    engine.restoreObjectGroups(file.groups)
  }

  northBearingDeg.value = file.north_bearing_deg ?? 0
  guides.value = normalizeGuides(file.extra?.guides)
  engine.restoreGuides()

  currentConsortiums.value = file.consortiums
  designLocation.value = file.location ? { lat: file.location.lat, lon: file.location.lon } : null

  if (plantsLayer) {
    void updatePlantLabelsForLocale(plantsLayer, locale.value)
  }

  engine.reconcileMaterializedScene()

  for (const name of LAYER_NAMES) {
    engine.layers.get(name)?.batchDraw()
  }
}

function normalizeGuides(rawGuides: unknown): Guide[] {
  return Array.isArray(rawGuides)
    ? rawGuides.filter(
        (guide): guide is Guide =>
          typeof guide === 'object' &&
          guide !== null &&
          typeof guide.id === 'string' &&
          (guide.axis === 'h' || guide.axis === 'v') &&
          typeof guide.position === 'number',
      )
    : []
}
