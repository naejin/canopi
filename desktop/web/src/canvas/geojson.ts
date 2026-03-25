import type { CanvasEngine } from './engine'
import { worldToGeo, geoToWorld } from './projection'

// ---------------------------------------------------------------------------
// GeoJSON export/import — AD-7: frontend builds data, Rust writes file
//
// Export: zones → Polygon features, plants → Point features
// Import: Polygon/MultiPolygon → zone shapes (other types skipped)
// ---------------------------------------------------------------------------

interface GeoJSONFeature {
  type: 'Feature'
  geometry: {
    type: string
    coordinates: unknown
  }
  properties: Record<string, unknown>
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

/**
 * Build a GeoJSON FeatureCollection from the current canvas state.
 * Requires a design location for coordinate projection.
 */
export function buildGeoJSON(
  engine: CanvasEngine,
  location: { lat: number; lon: number },
): string {
  const fc: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: [],
  }

  // Export plants as Point features (getPlacedPlants uses absolute positions)
  const plants = engine.getPlacedPlants()
  for (const plant of plants) {
    const geo = worldToGeo(plant.position.x, plant.position.y, location.lat, location.lon)
    fc.features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [geo.lng, geo.lat], // RFC 7946: [longitude, latitude]
      },
      properties: {
        id: plant.id,
        canonical_name: plant.canonical_name,
        common_name: plant.common_name,
        notes: plant.notes,
        planted_date: plant.planted_date,
        quantity: plant.quantity,
      },
    })
  }

  // Export zones as Polygon features
  const zonesLayer = engine.layers.get('zones')
  if (zonesLayer) {
    zonesLayer.find('.shape').forEach((node) => {
      if (node.hasName('plant-group') || node.hasName('object-group')) return

      const className = node.getClassName()
      const zoneCoords: [number, number][] = []
      // Use absolute transform to handle rotation, grouping, and other transforms
      const absTransform = node.getAbsoluteTransform(zonesLayer)

      if (className === 'Rect') {
        const r = node as import('konva').default.Rect
        const localCorners = [
          { x: 0, y: 0 },
          { x: r.width(), y: 0 },
          { x: r.width(), y: r.height() },
          { x: 0, y: r.height() },
          { x: 0, y: 0 }, // close ring
        ]
        for (const c of localCorners) {
          const abs = absTransform.point(c)
          const geo = worldToGeo(abs.x, abs.y, location.lat, location.lon)
          zoneCoords.push([geo.lng, geo.lat])
        }
      } else if (className === 'Line') {
        const l = node as import('konva').default.Line
        const pts = l.points()
        for (let i = 0; i < pts.length; i += 2) {
          const abs = absTransform.point({ x: pts[i] ?? 0, y: pts[i + 1] ?? 0 })
          const geo = worldToGeo(abs.x, abs.y, location.lat, location.lon)
          zoneCoords.push([geo.lng, geo.lat])
        }
        if (zoneCoords.length > 0) {
          zoneCoords.push(zoneCoords[0]!)
        }
      } else if (className === 'Ellipse') {
        const el = node as import('konva').default.Ellipse
        for (let i = 0; i <= 32; i++) {
          const angle = (i / 32) * Math.PI * 2
          const local = { x: el.radiusX() * Math.cos(angle), y: el.radiusY() * Math.sin(angle) }
          const abs = absTransform.point(local)
          const geo = worldToGeo(abs.x, abs.y, location.lat, location.lon)
          zoneCoords.push([geo.lng, geo.lat])
        }
      }

      if (zoneCoords.length >= 4) {
        fc.features.push({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [zoneCoords],
          },
          properties: {
            name: node.id(),
            zone_type: className.toLowerCase(),
            notes: (node as import('konva').default.Shape).getAttr('data-notes') ?? null,
          },
        })
      }
    })
  }

  return JSON.stringify(fc, null, 2)
}

/**
 * Import GeoJSON FeatureCollection — Polygon and MultiPolygon geometries only.
 * Other geometry types are silently skipped.
 * Holes in polygons are ignored (exterior ring only).
 * Requires a design location for inverse projection.
 */
export function parseGeoJSONZones(
  geojsonStr: string,
  location: { lat: number; lon: number },
): { name: string; points: { x: number; y: number }[]; notes: string | null }[] {
  const fc = JSON.parse(geojsonStr) as GeoJSONFeatureCollection
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return []

  const zones: { name: string; points: { x: number; y: number }[]; notes: string | null }[] = []

  for (const feature of fc.features) {
    if (feature.type !== 'Feature') continue
    const geomType = feature.geometry?.type

    let rings: [number, number][][] = []

    if (geomType === 'Polygon') {
      const coords = feature.geometry.coordinates as [number, number][][]
      if (coords.length > 0) rings = [coords[0]!] // exterior ring only, ignore holes
    } else if (geomType === 'MultiPolygon') {
      const coords = feature.geometry.coordinates as [number, number][][][]
      for (const polygon of coords) {
        if (polygon.length > 0) rings.push(polygon[0]!) // exterior ring only
      }
    } else {
      continue // Skip non-polygon geometries
    }

    for (const ring of rings) {
      const points = ring.map(([lng, lat]) => geoToWorld(lng, lat, location.lat, location.lon))
      const name = (feature.properties?.name as string) ?? `imported-${crypto.randomUUID().slice(0, 8)}`
      const notes = (feature.properties?.notes as string) ?? null

      zones.push({ name, points, notes })
    }
  }

  return zones
}

/**
 * Build a CSV string for budget items export.
 */
export function buildBudgetCSV(
  budget: { category: string; description: string; quantity: number; unit_cost: number; currency: string }[],
): string {
  const header = 'Category,Description,Quantity,Unit Cost,Total,Currency'
  const rows = budget.map((item) => {
    const total = item.quantity * item.unit_cost
    return [
      _csvEscape(item.category),
      _csvEscape(item.description),
      item.quantity,
      item.unit_cost.toFixed(2),
      total.toFixed(2),
      item.currency,
    ].join(',')
  })

  // Add total row
  const grandTotal = budget.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0)
  rows.push(`,,,,${grandTotal.toFixed(2)},${budget[0]?.currency ?? ''}`)

  return [header, ...rows].join('\n')
}

function _csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
