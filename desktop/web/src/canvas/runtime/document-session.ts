import Konva from 'konva'
import { getSpeciesBatch } from '../../ipc/species'
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
  const loadEpoch = engine.getDocumentLoadEpoch()
  for (const name of CONTENT_LAYERS) {
    engine.layers.get(name)?.destroyChildren()
  }

  const plantsLayer = engine.layers.get('plants')
  if (plantsLayer) {
    const canonicalNames: string[] = []
    for (const plant of file.plants) {
      canonicalNames.push(plant.canonical_name)
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

    if (canonicalNames.length > 0) {
      void backfillPlantDisplayAttrs(plantsLayer, canonicalNames, engine, loadEpoch).catch(() => {})
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
          draggable: false,
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
          draggable: false,
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
          draggable: false,
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

  engine.invalidateRender(
    'counter-scale',
    'plant-display',
    'lod',
    'annotations',
    'theme',
    'overlays',
    'density',
    'stacking',
  )

  for (const name of LAYER_NAMES) {
    engine.layers.get(name)?.batchDraw()
  }
}

async function backfillPlantDisplayAttrs(
  plantsLayer: Konva.Layer,
  canonicalNames: string[],
  engine: DocumentSessionEngine,
  loadEpoch: number,
): Promise<void> {
  const details = await getSpeciesBatch(canonicalNames, locale.value)
  if (details.length === 0) return
  if (engine.getDocumentLoadEpoch() !== loadEpoch) return

  const byCanonicalName = new Map(details.map((detail) => [detail.canonical_name, detail]))
  let updated = false

  plantsLayer.find('.plant-group').forEach((node: Konva.Node) => {
    const group = node as Konva.Group
    const canonicalName = group.getAttr('data-canonical-name') as string | undefined
    if (!canonicalName) return

    const detail = byCanonicalName.get(canonicalName)
    if (!detail) return

    if (detail.stratum != null) {
      group.setAttr('data-stratum', detail.stratum)
      updated = true
    }

    const currentCanopySpread = group.getAttr('data-canopy-spread') as number | null
    if ((currentCanopySpread == null || currentCanopySpread <= 0) && detail.width_max_m != null) {
      group.setAttr('data-canopy-spread', detail.width_max_m)
      updated = true
    }
  })

  if (updated) {
    engine.invalidateRender('plant-display', 'lod', 'density', 'stacking')
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
