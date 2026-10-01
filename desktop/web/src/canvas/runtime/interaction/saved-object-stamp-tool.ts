// canvas/runtime/interaction/saved-object-stamp-tool.ts  (0B legacy bridge only)
//
// The legacy bridge's saved-stamp drop (scene-interaction.ts) until the ToolHost's drop route (0B-4): the dragover ghost
// as DOM over the map and the drop's placement, both from tools/saved-object-stamp.ts's placement code at rotation 0.
// The saved stamp tool itself runs on the ToolHost (tools/saved-object-stamp.ts). Also lends the Place plants preview
// (plant-placement-preview.ts) its DOM plant symbol. Deleted with its last importer.

import { CANVAS_CHROME_FONT_FAMILY } from '../../chrome-fonts'
import type { SavedObjectStampPayload } from '../../saved-object-stamp-payload'
import { getAnnotationPresentation, ANNOTATION_MARKER_PATHS, ANNOTATION_MARKER_STROKE_PX } from '../annotation-layout'
import type { WorkspaceCameraFrameReader } from '../camera'
import {
  buildPlantPresentationEntries,
  type PlantPresentationEntry,
  type PlantPresentationContext,
} from '../plant-presentation'
import {
  getPlantSymbolArt,
  plantSymbolPath,
} from '../plant-symbol-recipes'
import type {
  PlantSymbolId,
  SceneAnnotationEntity,
  ScenePlantEntity,
  ScenePoint,
  SceneStateReader,
  SceneZoneEntity,
} from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import { getAnnotationTextColor, getLabelHalo, getPlantSymbolEdgeColor, getPlantSymbolEdgeWidth, resolveZoneVisual } from '../scene-visuals'
import {
  canPlaceSavedObjectStamp,
  placeSavedObjectStamp,
  savedObjectStampEntities,
} from '../tools/saved-object-stamp'
import type { StampEntities } from '../tools/stamp-rotation'
import { getEllipticalZonePolygon, getRectangularZoneCorners } from '../zone-geometry'
import { isSceneLayerOpenForCreation, type SceneCreationLayerName } from './layer-guards'

const SVG_NS = 'http://www.w3.org/2000/svg'
const STAMP_GHOST_OPACITY = 0.62
const STAMP_GHOST_ANNOTATION_OPACITY = 0.68
const ZONE_STROKE_WIDTH_PX = 2

export interface SavedObjectStampPlacementContext {
  readonly preview: HTMLDivElement
  readonly camera: WorkspaceCameraFrameReader
  readonly getSceneStore: () => SceneStateReader
  readonly getPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  readonly sceneEdits: SceneEditCoordinator
  readonly applySnapping: (point: ScenePoint) => ScenePoint
}

/** Places a dropped saved stamp level, its anchor at the snapped drop point. */
export function placeSavedObjectStampAt(
  context: SavedObjectStampPlacementContext,
  source: SavedObjectStampPayload,
  rawAnchorWorld: ScenePoint,
  onCommitted?: () => void,
): boolean {
  return placeSavedObjectStamp(
    context.sceneEdits,
    openLayers(context),
    source,
    context.applySnapping(rawAnchorWorld),
    onCommitted ? { onCommitted } : {},
  )
}

/** The dragover ghost of a saved stamp, level, its anchor at the snapped point; false when it cannot be dropped. */
export function previewSavedObjectStampAt(
  context: SavedObjectStampPlacementContext,
  source: SavedObjectStampPayload,
  rawAnchorWorld: ScenePoint,
): boolean {
  if (!canPlaceSavedObjectStamp(openLayers(context), source)) {
    clearSavedObjectStampGhosts(context.preview)
    return false
  }
  showStampGhosts(context, savedObjectStampEntities(source, context.applySnapping(rawAnchorWorld)))
  return true
}

function openLayers(context: Pick<SavedObjectStampPlacementContext, 'getSceneStore'>) {
  return {
    isLayerOpenForCreation: (layer: string) =>
      isSceneLayerOpenForCreation(context.getSceneStore().persisted, layer as SceneCreationLayerName),
  }
}

/** Draws a stamp's objects where a click would place them, as translucent ghosts over the map. */
function showStampGhosts(
  context: Pick<SavedObjectStampPlacementContext, 'preview' | 'camera' | 'getPlantPresentationContext'>,
  entities: StampEntities,
): void {
  const preview = context.preview
  preview.replaceChildren()
  const screenSize = context.camera.screenSize
  const width = Math.max(1, screenSize.width)
  const height = Math.max(1, screenSize.height)
  Object.assign(preview.style, {
    display: 'block',
    left: '0',
    top: '0',
    width: `${width}px`,
    height: `${height}px`,
    border: '0',
    borderRadius: '0',
    background: 'transparent',
    transform: 'none',
    transformOrigin: '0 0',
    pointerEvents: 'none',
    zIndex: '2',
  })

  const svg = createSvgElement('svg')
  svg.dataset.savedObjectStampGhost = 'root'
  setSvgAttributes(svg, {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    'aria-hidden': 'true',
    focusable: 'false',
  })
  Object.assign(svg.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    overflow: 'visible',
  })
  preview.appendChild(svg)

  for (const zone of entities.zones) appendZoneGhost(svg, context, zone)

  const plantContext = context.getPlantPresentationContext(context.camera.viewport.scale)
  for (const plant of entities.plants) appendPlantGhost(svg, context, plant, plantContext)

  for (const annotation of entities.annotations) appendAnnotationGhost(svg, context, annotation)
}

export function clearSavedObjectStampGhosts(preview: HTMLElement): void {
  preview.replaceChildren()
  preview.style.display = 'none'
}

function appendZoneGhost(
  svg: SVGSVGElement,
  context: Pick<SavedObjectStampPlacementContext, 'camera'>,
  zone: SceneZoneEntity,
): void {
  const visual = resolveZoneVisual(zone)
  const paint = {
    fill: zone.zoneType === 'line' ? 'none' : visual.fill,
    'fill-opacity': zone.zoneType === 'line' ? '0' : '0.2',
    stroke: visual.stroke,
    'stroke-width': ZONE_STROKE_WIDTH_PX,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    opacity: STAMP_GHOST_OPACITY,
  }

  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const center = context.camera.worldToScreen(zone.points[0]!)
    const radii = zone.points[1]!
    const ellipse = createSvgElement('ellipse')
    ellipse.dataset.savedObjectStampPart = 'zone'
    setSvgAttributes(ellipse, {
      ...paint,
      cx: center.x,
      cy: center.y,
      rx: Math.abs(radii.x * context.camera.viewport.scale),
      ry: Math.abs(radii.y * context.camera.viewport.scale),
      transform: `rotate(${formatNumber(zone.rotationDeg)} ${formatNumber(center.x)} ${formatNumber(center.y)})`,
    })
    svg.appendChild(ellipse)
    return
  }

  const points = zoneScreenPoints(zone, context.camera)
  if (points.length === 0) return

  const element = createSvgElement(zone.zoneType === 'line' ? 'polyline' : 'polygon')
  element.dataset.savedObjectStampPart = 'zone'
  setSvgAttributes(element, {
    ...paint,
    points: svgPoints(points),
  })
  svg.appendChild(element)
}

function zoneScreenPoints(zone: SceneZoneEntity, camera: WorkspaceCameraFrameReader): ScenePoint[] {
  if (zone.zoneType === 'rect') {
    return (getRectangularZoneCorners(zone) ?? []).map((point) => camera.worldToScreen(point))
  }
  if (zone.zoneType === 'ellipse') {
    return (getEllipticalZonePolygon(zone) ?? []).map((point) => camera.worldToScreen(point))
  }
  return zone.points.map((point) => camera.worldToScreen(point))
}

function appendPlantGhost(
  svg: SVGSVGElement,
  context: Pick<SavedObjectStampPlacementContext, 'camera'>,
  plant: ScenePlantEntity,
  plantContext: PlantPresentationContext,
): void {
  const group = createSvgElement('g')
  group.dataset.savedObjectStampPart = 'plant-symbol'
  if (appendPlantSymbolGhost(group, context.camera, plant, plantContext, STAMP_GHOST_OPACITY) !== null) svg.appendChild(group)
}

/**
 * Draws a plant as the map would, from the shared symbol contours, into
 * `group` at `opacity`: stamp ghosts and the Place plants preview. Returns
 * the symbol's screen radius, or null when the plant has no presentation.
 */
export function appendPlantSymbolGhost(
  group: SVGGElement,
  camera: WorkspaceCameraFrameReader,
  plant: ScenePlantEntity,
  plantContext: PlantPresentationContext,
  opacity: number,
): number | null {
  const entry = buildPlantPresentationEntries([plant], plantContext, new Set())[0]
  if (!entry) return null
  setSvgAttributes(group, {
    opacity,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  })
  appendPlantSymbolCommands(group, camera, entry, renderedPlantSymbol(entry))
  return entry.radiusWorld * camera.viewport.scale
}

function renderedPlantSymbol(entry: PlantPresentationEntry): PlantSymbolId {
  return entry.lod === 'dot' || entry.usesCanopyRadius ? 'round' : entry.symbol
}

function appendPlantSymbolCommands(
  group: SVGGElement,
  camera: WorkspaceCameraFrameReader,
  entry: PlantPresentationEntry,
  symbol: PlantSymbolId,
): void {
  const center = camera.worldToScreen(entry.plant.position)
  const radius = entry.radiusWorld * camera.viewport.scale
  if (entry.lod === 'dot') {
    const circle = createSvgElement('circle')
    setSvgAttributes(circle, { cx: center.x, cy: center.y, r: radius, fill: entry.color })
    group.appendChild(circle)
    return
  }

  const art = getPlantSymbolArt(symbol, radius * 2)
  const edge = getPlantSymbolEdgeColor(entry.color)
  const transform = `translate(${center.x} ${center.y}) scale(${radius})`
  const body = createSvgElement('path')
  setSvgAttributes(body, {
    d: plantSymbolPath(art.body),
    transform,
    fill: entry.color,
    'fill-opacity': 1,
    'fill-rule': 'nonzero',
    stroke: edge,
    'stroke-width': getPlantSymbolEdgeWidth(radius * 2) / radius,
    'stroke-linejoin': 'round',
    'paint-order': 'stroke fill',
  })
  group.appendChild(body)
  if (art.cutouts.length === 0) return
  const cutouts = createSvgElement('path')
  setSvgAttributes(cutouts, { d: plantSymbolPath(art.cutouts), transform, fill: edge, 'fill-rule': 'nonzero' })
  group.appendChild(cutouts)
}

function appendAnnotationGhost(
  svg: SVGSVGElement,
  context: Pick<SavedObjectStampPlacementContext, 'camera'>,
  annotation: SceneAnnotationEntity,
): void {
  if (annotation.annotationType !== 'text') return
  const { textFrame: frame, textOpacity, markerOpacity } = getAnnotationPresentation(annotation, context.camera.viewport)
  if (markerOpacity > 0) {
    const marker = createSvgElement('path')
    marker.dataset.savedObjectStampPart = 'annotation-marker'
    setSvgAttributes(marker, {
      d: ANNOTATION_MARKER_PATHS.map((path) => path.map((point, index) =>
        `${index === 0 ? 'M' : 'L'} ${formatNumber(frame.origin.x + point.x)} ${formatNumber(frame.origin.y + point.y)}`,
      ).join(' ')).join(' '),
      fill: 'none', stroke: getAnnotationTextColor(), 'stroke-width': ANNOTATION_MARKER_STROKE_PX,
      opacity: STAMP_GHOST_ANNOTATION_OPACITY * markerOpacity,
    })
    svg.appendChild(marker)
  }
  if (textOpacity === 0) return
  const text = createSvgElement('text')
  text.dataset.savedObjectStampPart = 'annotation'
  setSvgAttributes(text, {
    x: frame.origin.x,
    y: frame.origin.y,
    fill: getAnnotationTextColor(),
    stroke: getLabelHalo(annotation.fontSize).color,
    'stroke-width': getLabelHalo(annotation.fontSize).widthPx,
    'stroke-linejoin': 'round',
    'paint-order': 'stroke fill',
    'font-family': CANVAS_CHROME_FONT_FAMILY,
    'font-size': annotation.fontSize,
    opacity: STAMP_GHOST_ANNOTATION_OPACITY * textOpacity,
    transform: `rotate(${formatNumber(frame.rotationDeg)} ${formatNumber(frame.origin.x)} ${formatNumber(frame.origin.y)})`,
    'dominant-baseline': 'text-before-edge',
  })
  text.style.whiteSpace = 'pre'
  text.setAttribute('xml:space', 'preserve')

  const lines = annotation.text.split('\n')
  if (lines.length === 1) {
    text.textContent = lines[0] ?? ''
  } else {
    lines.forEach((line, index) => {
      const tspan = createSvgElement('tspan')
      tspan.textContent = line
      setSvgAttributes(tspan, {
        x: frame.origin.x,
        y: frame.origin.y + frame.lineHeightPx * index,
      })
      text.appendChild(tspan)
    })
  }
  svg.appendChild(text)
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag)
}

function setSvgAttributes(
  element: SVGElement,
  attributes: Record<string, string | number>,
): void {
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, typeof value === 'number' ? formatNumber(value) : value)
  }
}

function svgPoints(points: readonly ScenePoint[]): string {
  return points
    .map((point) => `${formatNumber(point.x)},${formatNumber(point.y)}`)
    .join(' ')
}

function formatNumber(value: number): string {
  if (Math.abs(value) < 0.000001) return '0'
  return Number(value.toFixed(3)).toString()
}
