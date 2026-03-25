import Konva from 'konva'
import type { CanvasEngine } from './engine'
import type { CanopiFile, PlacedPlant, Zone, Layer } from '../types/design'
import { createPlantNode } from './plants'
import { layerVisibility, layerLockState, northBearingDeg } from '../state/canvas'

const LAYER_NAMES = ['base', 'contours', 'climate', 'zones', 'water', 'plants', 'annotations'] as const

// ---------------------------------------------------------------------------
// Forward-compatibility: capture unknown top-level keys from Rust serde(flatten)
// ---------------------------------------------------------------------------

const KNOWN_CANOPI_KEYS = new Set([
  'version', 'name', 'description', 'location', 'north_bearing_deg',
  'layers', 'plants', 'zones', 'consortiums', 'timeline', 'budget',
  'created_at', 'updated_at',
])

/** Extract unknown top-level keys from a raw IPC-deserialized object. */
export function extractExtra(raw: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  for (const key of Object.keys(raw)) {
    if (!KNOWN_CANOPI_KEYS.has(key)) {
      extra[key] = raw[key]
    }
  }
  return extra
}

// ---------------------------------------------------------------------------
// Serialize canvas state → CanopiFile
// ---------------------------------------------------------------------------

export function toCanopi(
  engine: CanvasEngine,
  metadata: {
    name: string
    description?: string | null
    location?: { lat: number; lon: number; altitude_m?: number | null } | null
    northBearingDeg?: number | null
  },
  doc: CanopiFile | null,
): CanopiFile {
  const plants: PlacedPlant[] = engine.getPlacedPlants()

  // Collect zones from the zones layer
  const zones: Zone[] = []
  const zonesLayer = engine.layers.get('zones')
  if (zonesLayer) {
    zonesLayer.find('.shape').forEach((node: Konva.Node) => {
      // Skip plant groups (plants are on the plants layer, but be defensive)
      if (node.hasName('plant-group')) return

      const className = node.getClassName()
      const points: { x: number; y: number }[] = []

      if (className === 'Rect') {
        const r = node as Konva.Rect
        points.push(
          { x: r.x(), y: r.y() },
          { x: r.x() + r.width(), y: r.y() },
          { x: r.x() + r.width(), y: r.y() + r.height() },
          { x: r.x(), y: r.y() + r.height() },
        )
      } else if (className === 'Ellipse') {
        const el = node as Konva.Ellipse
        // Store center + radii encoded as 4 "points" for round-trip fidelity
        points.push(
          { x: el.x(), y: el.y() },
          { x: el.radiusX(), y: el.radiusY() },
        )
      } else if (className === 'Line') {
        const l = node as Konva.Line
        const pts = l.points()
        const ox = l.x()
        const oy = l.y()
        for (let i = 0; i < pts.length; i += 2) {
          points.push({ x: (pts[i] ?? 0) + ox, y: (pts[i + 1] ?? 0) + oy })
        }
      }

      const fill = (node as Konva.Shape).fill?.() ?? null

      zones.push({
        name: node.id(),
        zone_type: className.toLowerCase(),
        points,
        fill_color: typeof fill === 'string' ? fill : null,
        notes: (node as Konva.Shape).getAttr('data-notes') ?? null,
      })
    })
  }

  // Collect layer state from signals (source of truth for visibility/lock)
  const vis = layerVisibility.value
  const locks = layerLockState.value
  const layers: Layer[] = LAYER_NAMES.map((name) => {
    const layer = engine.layers.get(name)
    return {
      name,
      visible: vis[name] ?? true,
      locked: locks[name] ?? false,
      opacity: layer?.opacity() ?? 1,
    }
  })

  const now = new Date().toISOString()

  return {
    // Spread extra FIRST — canonical keys below always win over unknown fields
    ...(doc?.extra ?? {}),
    version: 1,
    name: metadata.name,
    description: metadata.description ?? doc?.description ?? null,
    location: metadata.location
      ? {
          lat: metadata.location.lat,
          lon: metadata.location.lon,
          altitude_m: metadata.location.altitude_m ?? null,
        }
      : (doc?.location ?? null),
    north_bearing_deg: metadata.northBearingDeg ?? northBearingDeg.value,
    layers,
    plants,
    zones,
    consortiums: doc?.consortiums ?? [],
    timeline: doc?.timeline ?? [],
    budget: doc?.budget ?? [],
    created_at: doc?.created_at ?? now,
    updated_at: now,
  }
}

// ---------------------------------------------------------------------------
// Deserialize CanopiFile → canvas engine
// ---------------------------------------------------------------------------

// Layers that hold user-created content and must be cleared when loading a
// new design. 'base' is intentionally excluded — it holds the grid shape that
// engine.init() adds, and destroying it would permanently remove the grid.
const CONTENT_LAYERS = ['contours', 'climate', 'zones', 'water', 'plants', 'annotations'] as const

export function fromCanopi(file: CanopiFile, engine: CanvasEngine): void {
  // Clear only user-content layers; leave 'base' (grid) and 'ui' (scale bar /
  // compass) untouched.
  for (const name of CONTENT_LAYERS) {
    engine.layers.get(name)?.destroyChildren()
  }

  // Restore plants
  const plantsLayer = engine.layers.get('plants')
  if (plantsLayer) {
    for (const plant of file.plants) {
      const node = createPlantNode({
        id: crypto.randomUUID(),
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
      if (plant.scale != null) node.scale({ x: plant.scale, y: plant.scale })
      plantsLayer.add(node as unknown as Konva.Shape)
    }
  }

  // Restore zones
  const zonesLayer = engine.layers.get('zones')
  if (zonesLayer) {
    for (const zone of file.zones) {
      let shape: Konva.Shape | null = null

      if (zone.zone_type === 'rect' && zone.points.length >= 4) {
        const p0 = zone.points[0]!
        const p2 = zone.points[2]!
        shape = new Konva.Rect({
          id: zone.name,
          x: p0.x,
          y: p0.y,
          width: p2.x - p0.x,
          height: p2.y - p0.y,
          fill: zone.fill_color ?? 'rgba(45, 95, 63, 0.1)',
          stroke: '#2D5F3F',
          strokeWidth: 2,
          strokeScaleEnabled: false,
          draggable: true,
          name: 'shape',
        })
      } else if (zone.zone_type === 'ellipse' && zone.points.length >= 2) {
        const center = zone.points[0]!
        const radii = zone.points[1]!
        shape = new Konva.Ellipse({
          id: zone.name,
          x: center.x,
          y: center.y,
          radiusX: radii.x,
          radiusY: radii.y,
          fill: zone.fill_color ?? 'rgba(45, 95, 63, 0.1)',
          stroke: '#2D5F3F',
          strokeWidth: 2,
          strokeScaleEnabled: false,
          draggable: true,
          name: 'shape',
        })
      } else if (
        (zone.zone_type === 'line' || zone.zone_type === 'polygon' || zone.zone_type === 'freeform') &&
        zone.points.length >= 2
      ) {
        const pts: number[] = []
        for (const p of zone.points) {
          pts.push(p.x, p.y)
        }
        const closed = zone.zone_type !== 'line'
        shape = new Konva.Line({
          id: zone.name,
          points: pts,
          closed,
          fill: closed ? (zone.fill_color ?? 'rgba(45, 95, 63, 0.1)') : undefined,
          stroke: '#2D5F3F',
          strokeWidth: 2,
          strokeScaleEnabled: false,
          draggable: true,
          name: 'shape',
        })
      }

      if (shape) {
        shape.setAttr('data-notes', zone.notes ?? null)
        zonesLayer.add(shape)
      }
    }
  }

  // Restore layer visibility and lock state from file
  if (file.layers.length > 0) {
    const vis: Record<string, boolean> = { ...layerVisibility.value }
    const locks: Record<string, boolean> = { ...layerLockState.value }
    for (const l of file.layers) {
      vis[l.name] = l.visible
      locks[l.name] = l.locked
      const layer = engine.layers.get(l.name)
      if (layer) {
        layer.visible(l.visible)
        layer.opacity(l.opacity)
      }
    }
    layerVisibility.value = vis
    layerLockState.value = locks
  }

  // Restore compass bearing — always reset to prevent leaking from previous document
  northBearingDeg.value = file.north_bearing_deg ?? 0

  // One batchDraw per layer
  for (const name of LAYER_NAMES) {
    engine.layers.get(name)?.batchDraw()
  }
}
