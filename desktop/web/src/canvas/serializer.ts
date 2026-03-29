import Konva from 'konva'
import type { CanvasEngine } from './engine'
import type { CanopiFile, PlacedPlant, Zone, Layer } from '../types/design'
import { layerVisibility, layerLockState, northBearingDeg, guides } from '../state/canvas'
import { loadDocumentSession } from './runtime/document-session'

const LAYER_NAMES = ['base', 'contours', 'climate', 'zones', 'water', 'plants', 'annotations'] as const

// ---------------------------------------------------------------------------
// Forward-compatibility: capture unknown top-level keys from Rust serde(flatten)
// ---------------------------------------------------------------------------

const KNOWN_CANOPI_KEYS = new Set([
  'version', 'name', 'description', 'location', 'north_bearing_deg',
  'layers', 'plants', 'zones', 'consortiums', 'groups', 'timeline', 'budget',
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

  // Persist guides into extra (forward-compatible — older versions ignore it)
  const extra: Record<string, unknown> = { ...(doc?.extra ?? {}) }
  if (guides.value.length > 0) {
    extra.guides = guides.value
  } else {
    delete extra.guides
  }

  return {
    // Spread extra FIRST — canonical keys below always win over unknown fields
    ...extra,
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
    groups: engine.getObjectGroups(),
    timeline: doc?.timeline ?? [],
    budget: doc?.budget ?? [],
    created_at: doc?.created_at ?? now,
    updated_at: now,
  }
}

export function fromCanopi(file: CanopiFile, engine: CanvasEngine): void {
  loadDocumentSession(file, engine)
}
