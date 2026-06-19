import { clearSavedObjectStampSource, readSavedObjectStampSource } from '../../saved-object-stamp-source'
import type { SavedObjectStampPayload } from '../../saved-object-stamp-payload'
import { createUuid } from '../../../utils/ids'
import { getAnnotationScreenFrame } from '../annotation-layout'
import type { CameraController } from '../camera'
import {
  buildPlantPresentationEntries,
  type PlantPresentationEntry,
  type PlantPresentationContext,
} from '../plant-presentation'
import {
  DEFAULT_PLANT_SYMBOL_LINE_STROKE_WIDTH,
  DEFAULT_PLANT_SYMBOL_SHAPE_STROKE_WIDTH,
  PLANT_SYMBOL_RECIPES,
} from '../plant-symbol-recipes'
import type {
  PlantSymbolId,
  SceneAnnotationEntity,
  SceneObjectGroupEntity,
  SceneObjectGroupMember,
  ScenePersistedState,
  ScenePlantEntity,
  ScenePoint,
  SceneStore,
  SceneZoneEntity,
} from '../scene'
import {
  sceneObjectGroupMemberKey,
} from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import { getAnnotationTextColor, resolveZoneVisual } from '../scene-visuals'
import { getEllipticalZonePolygon, getRectangularZoneCorners } from '../zone-geometry'
import { isSceneLayerOpenForCreation, type SceneCreationLayerName } from './layer-guards'
import { isEditableTarget } from './pointer-utils'
import type { SceneToolAdapter } from './tool-adapter'

const SVG_NS = 'http://www.w3.org/2000/svg'
const STAMP_GHOST_OPACITY = 0.62
const STAMP_GHOST_ANNOTATION_OPACITY = 0.68
const ZONE_STROKE_WIDTH_PX = 2
const PLANT_SYMBOL_STROKE_WIDTH_PX = 1.6

export interface SavedObjectStampPlacementContext {
  readonly preview: HTMLDivElement
  readonly camera: CameraController
  readonly getSceneStore: () => SceneStore
  readonly getPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  readonly sceneEdits: SceneEditCoordinator
  readonly applySnapping: (point: ScenePoint) => ScenePoint
}

export interface SavedObjectStampToolContext extends SavedObjectStampPlacementContext {
  readonly switchTool: (name: string) => void
}

export interface SavedObjectStampTool {
  readonly hasSource: () => boolean
  readonly pointerDown: (world: ScenePoint) => void
  readonly updatePreview: (world: ScenePoint) => void
  readonly clear: () => void
  readonly dispose: () => void
}

export function createSavedObjectStampTool(context: SavedObjectStampToolContext): SavedObjectStampTool {
  function hasSource(): boolean {
    return readSavedObjectStampSource() !== null
  }

  function pointerDown(world: ScenePoint): void {
    const source = readSavedObjectStampSource()
    if (!source || !canPlaceSavedObjectStamp(context.getSceneStore().persisted, source)) return
    const committed = placeSavedObjectStampAt(context, source, world)
    if (committed) {
      clear()
      context.switchTool('select')
    }
  }

  function updatePreview(world: ScenePoint): void {
    const source = readSavedObjectStampSource()
    if (!source) clearSavedObjectStampGhosts(context.preview)
    else previewSavedObjectStampAt(context, source, world)
  }

  function clear(): void {
    clearSavedObjectStampSource()
    clearSavedObjectStampGhosts(context.preview)
  }

  return {
    hasSource,
    pointerDown,
    updatePreview,
    clear,
    dispose: clear,
  }
}

export function createSavedObjectStampToolAdapter(
  tool: SavedObjectStampTool,
  context: Pick<SavedObjectStampToolContext, 'switchTool'>,
): SceneToolAdapter {
  return {
    onDeactivate: tool.clear,
    shouldSuppressHover: tool.hasSource,
    pointerDown({ event, rawWorld, clearPointerGesture }) {
      event.preventDefault()
      tool.pointerDown(rawWorld)
      clearPointerGesture()
      return true
    },
    pointerMoveWithoutCapture({ rawWorld }) {
      if (!tool.hasSource()) return false
      tool.updatePreview(rawWorld)
      return true
    },
    keyDown(event) {
      if (event.key !== 'Escape' || isEditableTarget(event.target)) return false
      event.preventDefault()
      tool.clear()
      context.switchTool('select')
      return true
    },
    dispose: tool.dispose,
  }
}

function copySavedObjectStampToDraft(
  draft: ScenePersistedState,
  source: SavedObjectStampPayload,
  delta: ScenePoint,
): { selection: string[] } {
  const sourceToCloneId = new Map<string, string>()
  const existingZoneNames = new Set(draft.zones.map((zone) => zone.name))

  const plants = source.plants.map((plant): ScenePlantEntity => {
    const clone: ScenePlantEntity = {
      kind: 'plant',
      id: createUuid(),
      locked: false,
      canonicalName: plant.canonicalName,
      commonName: plant.commonName,
      color: plant.color,
      symbol: plant.symbol ?? null,
      stratum: null,
      canopySpreadM: plant.scale,
      position: translatePoint(plant.position, delta),
      rotationDeg: plant.rotationDeg,
      scale: plant.scale,
      notes: null,
      plantedDate: null,
      quantity: null,
    }
    sourceToCloneId.set(sceneObjectGroupMemberKey({ kind: 'plant', id: plant.id }), clone.id)
    return clone
  })

  const zones = source.zones.map((zone): SceneZoneEntity => {
    const name = uniqueZoneName(zone.name, existingZoneNames)
    existingZoneNames.add(name)
    const clone: SceneZoneEntity = {
      kind: 'zone',
      name,
      locked: false,
      zoneType: zone.zoneType,
      points: translateZonePoints(zone, delta),
      rotationDeg: zone.rotationDeg,
      fillColor: zone.fillColor,
      notes: null,
    }
    sourceToCloneId.set(sceneObjectGroupMemberKey({ kind: 'zone', id: zone.id }), clone.name)
    return clone
  })

  const annotations = source.annotations.map((annotation): SceneAnnotationEntity => {
    const clone: SceneAnnotationEntity = {
      kind: 'annotation',
      id: createUuid(),
      locked: false,
      annotationType: annotation.annotationType,
      position: translatePoint(annotation.position, delta),
      text: annotation.text,
      fontSize: annotation.fontSize,
      rotationDeg: annotation.rotationDeg,
    }
    sourceToCloneId.set(sceneObjectGroupMemberKey({ kind: 'annotation', id: annotation.id }), clone.id)
    return clone
  })

  const groupedMemberKeys = new Set<string>()
  const groups = source.groups
    .map((group): SceneObjectGroupEntity | null => {
      const members = group.members
        .map((member): SceneObjectGroupMember | null => {
          const cloneId = sourceToCloneId.get(sceneObjectGroupMemberKey(member))
          return cloneId ? { kind: member.kind, id: cloneId } : null
        })
        .filter((member): member is SceneObjectGroupMember => member !== null)
      if (members.length < 2) return null
      for (const member of members) {
        groupedMemberKeys.add(sceneObjectGroupMemberKey(member))
      }
      return {
        kind: 'group',
        id: createUuid(),
        locked: false,
        name: group.name,
        members,
      }
    })
    .filter((group): group is SceneObjectGroupEntity => group !== null)

  draft.plants = [...draft.plants, ...plants]
  draft.zones = [...draft.zones, ...zones]
  draft.annotations = [...draft.annotations, ...annotations]
  draft.groups = [...draft.groups, ...groups]

  return {
    selection: selectedTopLevelIds(plants, zones, annotations, groups, groupedMemberKeys),
  }
}

function selectedTopLevelIds(
  plants: readonly ScenePlantEntity[],
  zones: readonly SceneZoneEntity[],
  annotations: readonly SceneAnnotationEntity[],
  groups: readonly SceneObjectGroupEntity[],
  groupedMemberKeys: ReadonlySet<string>,
): string[] {
  const selection = groups.map((group) => group.id)
  for (const plant of plants) {
    if (!groupedMemberKeys.has(sceneObjectGroupMemberKey({ kind: 'plant', id: plant.id }))) {
      selection.push(plant.id)
    }
  }
  for (const zone of zones) {
    if (!groupedMemberKeys.has(sceneObjectGroupMemberKey({ kind: 'zone', id: zone.name }))) {
      selection.push(zone.name)
    }
  }
  for (const annotation of annotations) {
    if (!groupedMemberKeys.has(sceneObjectGroupMemberKey({ kind: 'annotation', id: annotation.id }))) {
      selection.push(annotation.id)
    }
  }
  return selection
}

export function placeSavedObjectStampAt(
  context: SavedObjectStampPlacementContext,
  source: SavedObjectStampPayload,
  rawAnchorWorld: ScenePoint,
): boolean {
  if (!canPlaceSavedObjectStamp(context.getSceneStore().persisted, source)) return false
  const delta = stampDelta(source, context.applySnapping(rawAnchorWorld))
  let selection: string[] = []
  return context.sceneEdits.run('interaction-saved-object-stamp', (tx) => {
    tx.mutate((draft) => {
      const copied = copySavedObjectStampToDraft(draft, source, delta)
      selection = copied.selection
    })
    if (selection.length > 0) tx.setSelection(selection)
  })
}

export function previewSavedObjectStampAt(
  context: SavedObjectStampPlacementContext,
  source: SavedObjectStampPayload,
  rawAnchorWorld: ScenePoint,
): boolean {
  if (!canPlaceSavedObjectStamp(context.getSceneStore().persisted, source)) {
    clearSavedObjectStampGhosts(context.preview)
    return false
  }
  showSavedObjectStampGhosts(context, source, stampDelta(source, context.applySnapping(rawAnchorWorld)))
  return true
}

export function canPlaceSavedObjectStamp(scene: ScenePersistedState, source: SavedObjectStampPayload): boolean {
  if (source.plants.length + source.zones.length + source.annotations.length === 0) return false
  return requiredLayers(source).every((layerName) => isSceneLayerOpenForCreation(scene, layerName))
}

function requiredLayers(source: SavedObjectStampPayload): SceneCreationLayerName[] {
  const layers: SceneCreationLayerName[] = []
  if (source.plants.length > 0) layers.push('plants')
  if (source.zones.length > 0) layers.push('zones')
  if (source.annotations.length > 0) layers.push('annotations')
  return layers
}

function showSavedObjectStampGhosts(
  context: SavedObjectStampPlacementContext,
  source: SavedObjectStampPayload,
  delta: ScenePoint,
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

  for (const zone of source.zones) {
    appendZoneGhost(svg, context, sceneZoneFromSavedZone(zone, delta))
  }

  const plantContext = context.getPlantPresentationContext(context.camera.viewport.scale)
  for (const plant of source.plants) {
    appendPlantGhost(svg, context, scenePlantFromSavedPlant(plant, delta), plantContext)
  }

  for (const annotation of source.annotations) {
    appendAnnotationGhost(svg, context, sceneAnnotationFromSavedAnnotation(annotation, delta))
  }
}

export function clearSavedObjectStampGhosts(preview: HTMLElement): void {
  preview.replaceChildren()
  preview.style.display = 'none'
}

function appendZoneGhost(
  svg: SVGSVGElement,
  context: SavedObjectStampPlacementContext,
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

function zoneScreenPoints(zone: SceneZoneEntity, camera: CameraController): ScenePoint[] {
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
  context: SavedObjectStampPlacementContext,
  plant: ScenePlantEntity,
  plantContext: PlantPresentationContext,
): void {
  const entry = buildPlantPresentationEntries([plant], plantContext, new Set())[0]
  if (!entry) return

  const group = createSvgElement('g')
  group.dataset.savedObjectStampPart = 'plant-symbol'
  setSvgAttributes(group, {
    opacity: STAMP_GHOST_OPACITY,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  })
  appendPlantSymbolCommands(group, context.camera, entry, renderedPlantSymbol(entry))
  svg.appendChild(group)
}

function renderedPlantSymbol(entry: PlantPresentationEntry): PlantSymbolId {
  return entry.lod === 'dot' || entry.usesCanopyRadius ? 'round' : entry.symbol
}

function appendPlantSymbolCommands(
  group: SVGGElement,
  camera: CameraController,
  entry: PlantPresentationEntry,
  symbol: PlantSymbolId,
): void {
  const center = camera.worldToScreen(entry.plant.position)
  const radius = entry.radiusWorld * camera.viewport.scale

  for (const command of PLANT_SYMBOL_RECIPES[symbol]) {
    switch (command.kind) {
      case 'circle': {
        const circle = createSvgElement('circle')
        setSvgAttributes(circle, {
          cx: center.x + command.cx * radius,
          cy: center.y + command.cy * radius,
          r: command.radius * radius,
        })
        applyPlantSymbolPaint(circle, entry.color, command.fill, command.stroke, PLANT_SYMBOL_STROKE_WIDTH_PX)
        group.appendChild(circle)
        break
      }
      case 'rect': {
        const rect = createSvgElement('rect')
        setSvgAttributes(rect, {
          x: center.x + command.x * radius,
          y: center.y + command.y * radius,
          width: command.width * radius,
          height: command.height * radius,
        })
        applyPlantSymbolPaint(rect, entry.color, command.fill, command.stroke, PLANT_SYMBOL_STROKE_WIDTH_PX)
        group.appendChild(rect)
        break
      }
      case 'path': {
        const path = createSvgElement('path')
        setSvgAttributes(path, {
          d: svgPathData(command.points.map(([x, y]) => ({
            x: center.x + x * radius,
            y: center.y + y * radius,
          })), command.closed),
        })
        const strokeWidth = PLANT_SYMBOL_STROKE_WIDTH_PX * (
          (command.strokeWidth ?? DEFAULT_PLANT_SYMBOL_SHAPE_STROKE_WIDTH) /
          DEFAULT_PLANT_SYMBOL_SHAPE_STROKE_WIDTH
        )
        applyPlantSymbolPaint(path, entry.color, command.fill, command.stroke, strokeWidth)
        group.appendChild(path)
        break
      }
      case 'lines': {
        const path = createSvgElement('path')
        const d = command.segments
          .map(([x1, y1, x2, y2]) => (
            `M ${formatNumber(center.x + x1 * radius)} ${formatNumber(center.y + y1 * radius)} `
            + `L ${formatNumber(center.x + x2 * radius)} ${formatNumber(center.y + y2 * radius)}`
          ))
          .join(' ')
        setSvgAttributes(path, { d })
        const strokeWidth = PLANT_SYMBOL_STROKE_WIDTH_PX * (
          (command.strokeWidth ?? DEFAULT_PLANT_SYMBOL_LINE_STROKE_WIDTH) /
          DEFAULT_PLANT_SYMBOL_LINE_STROKE_WIDTH
        )
        applyPlantSymbolPaint(path, entry.color, false, true, strokeWidth)
        group.appendChild(path)
        break
      }
    }
  }
}

function applyPlantSymbolPaint(
  element: SVGElement,
  color: string,
  fill: boolean,
  stroke: boolean,
  strokeWidth: number,
): void {
  setSvgAttributes(element, {
    fill: fill ? color : 'none',
    'fill-opacity': fill ? '0.55' : '0',
    stroke: stroke ? color : 'none',
    'stroke-opacity': stroke ? '1' : '0',
    'stroke-width': stroke ? strokeWidth : 0,
  })
}

function appendAnnotationGhost(
  svg: SVGSVGElement,
  context: SavedObjectStampPlacementContext,
  annotation: SceneAnnotationEntity,
): void {
  if (annotation.annotationType !== 'text') return
  const frame = getAnnotationScreenFrame(annotation, context.camera.viewport)
  const text = createSvgElement('text')
  text.dataset.savedObjectStampPart = 'annotation'
  setSvgAttributes(text, {
    x: frame.origin.x,
    y: frame.origin.y,
    fill: getAnnotationTextColor(),
    'font-family': 'Inter, sans-serif',
    'font-size': annotation.fontSize,
    opacity: STAMP_GHOST_ANNOTATION_OPACITY,
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

function svgPathData(points: readonly ScenePoint[], closed: boolean): string {
  const first = points[0]
  if (!first) return ''
  const segments = [`M ${formatNumber(first.x)} ${formatNumber(first.y)}`]
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!
    segments.push(`L ${formatNumber(point.x)} ${formatNumber(point.y)}`)
  }
  if (closed) segments.push('Z')
  return segments.join(' ')
}

function formatNumber(value: number): string {
  if (Math.abs(value) < 0.000001) return '0'
  return Number(value.toFixed(3)).toString()
}

function scenePlantFromSavedPlant(
  plant: SavedObjectStampPayload['plants'][number],
  delta: ScenePoint,
): ScenePlantEntity {
  return {
    kind: 'plant',
    id: plant.id,
    locked: false,
    canonicalName: plant.canonicalName,
    commonName: plant.commonName,
    color: plant.color,
    symbol: plant.symbol ?? null,
    stratum: null,
    canopySpreadM: plant.scale,
    position: translatePoint(plant.position, delta),
    rotationDeg: plant.rotationDeg,
    scale: plant.scale,
    notes: null,
    plantedDate: null,
    quantity: null,
  }
}

function sceneZoneFromSavedZone(
  zone: SavedObjectStampPayload['zones'][number],
  delta: ScenePoint,
): SceneZoneEntity {
  return {
    kind: 'zone',
    name: zone.name,
    locked: false,
    zoneType: zone.zoneType,
    points: translateZonePoints(zone, delta),
    rotationDeg: zone.rotationDeg,
    fillColor: zone.fillColor,
    notes: null,
  }
}

function sceneAnnotationFromSavedAnnotation(
  annotation: SavedObjectStampPayload['annotations'][number],
  delta: ScenePoint,
): SceneAnnotationEntity {
  return {
    kind: 'annotation',
    id: annotation.id,
    locked: false,
    annotationType: annotation.annotationType,
    position: translatePoint(annotation.position, delta),
    text: annotation.text,
    fontSize: annotation.fontSize,
    rotationDeg: annotation.rotationDeg,
  }
}

function stampDelta(source: SavedObjectStampPayload, anchorWorld: ScenePoint): ScenePoint {
  return {
    x: anchorWorld.x - source.anchor.x,
    y: anchorWorld.y - source.anchor.y,
  }
}

function translatePoint(point: ScenePoint, delta: ScenePoint): ScenePoint {
  return {
    x: point.x + delta.x,
    y: point.y + delta.y,
  }
}

function translateZonePoints(
  zone: Pick<SavedObjectStampPayload['zones'][number], 'zoneType' | 'points'>,
  delta: ScenePoint,
): ScenePoint[] {
  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    return [
      translatePoint(zone.points[0]!, delta),
      { ...zone.points[1]! },
    ]
  }
  return zone.points.map((point) => translatePoint(point, delta))
}

function uniqueZoneName(baseName: string, existingNames: Set<string>): string {
  if (!existingNames.has(baseName)) return baseName
  let index = 2
  let candidate = `${baseName} copy`
  while (existingNames.has(candidate)) {
    candidate = `${baseName} copy ${index}`
    index += 1
  }
  return candidate
}
