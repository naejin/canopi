import { getCurrentCanvasDocumentSurface } from '../../canvas/session'
import type { CanvasDocumentSurface } from '../../canvas/runtime/runtime'
import { buildPersistedDesignSessionContent } from '../document-session/persistence'
import { designSessionStore, type DesignSessionStore } from '../document-session/store'
import type { Annotation, CanopiFile, Location, PlacedPlant, Zone } from '../../types/design'
import { exportDesignReportPdf } from '../../ipc/design-report'

export type DesignReportPageOrientation = 'portrait' | 'landscape'

export interface DesignReportBounds {
  readonly min_x: number
  readonly min_y: number
  readonly max_x: number
  readonly max_y: number
}

export interface DesignReportCanvasPageInput {
  readonly orientation: DesignReportPageOrientation
  readonly width_mm: number
  readonly height_mm: number
  readonly margin_mm: number
  readonly background: '#FFFFFF'
}

export interface DesignReportMetadataInput {
  readonly description?: string
  readonly location?: Location
}

export interface DesignReportPlantInput {
  readonly id: string
  readonly canonical_name: string
  readonly common_name: string | null
  readonly color: string | null
  readonly symbol: string | null
  readonly radius_m: number | null
  readonly x: number
  readonly y: number
}

export interface DesignReportZoneInput {
  readonly name: string
  readonly zone_type: string
  readonly fill_color: string | null
  readonly points: readonly { readonly x: number; readonly y: number }[]
}

export interface DesignReportAnnotationInput {
  readonly id: string
  readonly text: string
  readonly x: number
  readonly y: number
}

export interface DesignReportCanvasInput {
  readonly page: DesignReportCanvasPageInput
  readonly bounds: DesignReportBounds | null
  readonly visible_layer_names: readonly string[]
  readonly plants: readonly DesignReportPlantInput[]
  readonly zones: readonly DesignReportZoneInput[]
  readonly annotations: readonly DesignReportAnnotationInput[]
}

export interface DesignReportInput {
  readonly title: string
  readonly metadata: DesignReportMetadataInput
  readonly canvas: DesignReportCanvasInput
}

interface CurrentDesignReportOptions {
  readonly session?: CanvasDocumentSurface | null
  readonly store?: DesignSessionStore
}

const A4_PORTRAIT = { width_mm: 210, height_mm: 297 } as const
const REPORT_MARGIN_MM = 14

export function buildDesignReportInput(file: CanopiFile): DesignReportInput {
  const canvas = buildCanvasInput(file)
  const description = nonEmptyString(file.description)

  return {
    title: nonEmptyString(file.name) ?? 'Untitled Design',
    metadata: {
      ...(description ? { description } : {}),
      ...(file.location ? { location: file.location } : {}),
    },
    canvas,
  }
}

export function buildCurrentDesignReportInput({
  session = getCurrentCanvasDocumentSurface(),
  store = designSessionStore,
}: CurrentDesignReportOptions = {}): DesignReportInput | null {
  if (!store.hasCurrentDesign()) return null

  const file = buildPersistedDesignSessionContent({
    session,
    name: store.readDesignName(),
    store,
  })
  return buildDesignReportInput(file)
}

export async function exportCurrentDesignReportPdf(
  options: CurrentDesignReportOptions = {},
): Promise<string | null> {
  const input = buildCurrentDesignReportInput(options)
  if (!input) return null
  return exportDesignReportPdf(input, defaultReportFileName(input.title))
}

function buildCanvasInput(file: CanopiFile): DesignReportCanvasInput {
  const plants = isLayerVisible(file, 'plants') ? file.plants.map(reportPlant) : []
  const zones = isLayerVisible(file, 'zones') ? file.zones.map(reportZone) : []
  const annotations = isLayerVisible(file, 'annotations') ? file.annotations.map(reportAnnotation) : []
  const bounds = computeReportBounds(plants, zones, annotations)
  const orientation = choosePageOrientation(bounds)
  const page = {
    orientation,
    width_mm: orientation === 'landscape' ? A4_PORTRAIT.height_mm : A4_PORTRAIT.width_mm,
    height_mm: orientation === 'landscape' ? A4_PORTRAIT.width_mm : A4_PORTRAIT.height_mm,
    margin_mm: REPORT_MARGIN_MM,
    background: '#FFFFFF',
  } as const

  return {
    page,
    bounds,
    visible_layer_names: file.layers
      .filter((layer) => layer.visible)
      .map((layer) => layer.name),
    plants,
    zones,
    annotations,
  }
}

function reportPlant(plant: PlacedPlant): DesignReportPlantInput {
  return {
    id: plant.id,
    canonical_name: plant.canonical_name,
    common_name: plant.common_name,
    color: plant.color ?? null,
    symbol: plant.symbol ?? null,
    radius_m: typeof plant.scale === 'number' && plant.scale > 0 ? plant.scale / 2 : null,
    x: plant.position.x,
    y: plant.position.y,
  }
}

function reportZone(zone: Zone): DesignReportZoneInput {
  return {
    name: zone.name,
    zone_type: zone.zone_type,
    fill_color: zone.fill_color ?? null,
    points: zone.points.map((point) => ({ x: point.x, y: point.y })),
  }
}

function reportAnnotation(annotation: Annotation): DesignReportAnnotationInput {
  return {
    id: annotation.id,
    text: annotation.text,
    x: annotation.position.x,
    y: annotation.position.y,
  }
}

function isLayerVisible(file: CanopiFile, layerName: string): boolean {
  return file.layers.find((layer) => layer.name === layerName)?.visible !== false
}

function choosePageOrientation(bounds: DesignReportBounds | null): DesignReportPageOrientation {
  if (!bounds) return 'portrait'
  return bounds.max_x - bounds.min_x > bounds.max_y - bounds.min_y ? 'landscape' : 'portrait'
}

function computeReportBounds(
  plants: readonly DesignReportPlantInput[],
  zones: readonly DesignReportZoneInput[],
  annotations: readonly DesignReportAnnotationInput[],
): DesignReportBounds | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  const includePoint = (x: number, y: number): void => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  for (const plant of plants) {
    const radius = plant.radius_m ?? 0
    includePoint(plant.x - radius, plant.y - radius)
    includePoint(plant.x + radius, plant.y + radius)
  }
  for (const zone of zones) {
    for (const point of zone.points) includePoint(point.x, point.y)
  }
  for (const annotation of annotations) includePoint(annotation.x, annotation.y)

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  return { min_x: minX, min_y: minY, max_x: maxX, max_y: maxY }
}

function defaultReportFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return `${cleaned || 'Untitled Design'} Design Report.pdf`
}

function nonEmptyString(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
