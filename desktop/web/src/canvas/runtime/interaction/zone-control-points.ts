import type { CameraController } from '../camera'
import type { CanvasDesignObjectSelectionModel } from '../runtime'
import type { ScenePoint, SceneStore, SceneZoneEntity } from '../scene'
import type { SceneEditCoordinator, SceneEditTransaction } from '../scene-runtime/transactions'
import { getRectangularZoneCorners } from '../zone-geometry'
import type { SceneInteractionPointerDrag, SceneInteractionPointerEvent } from './frame'

interface ZoneControlPointOptions {
  readonly container: HTMLElement
  readonly camera: CameraController
  readonly getSceneStore: () => SceneStore
  readonly getSelection: () => CanvasDesignObjectSelectionModel
  readonly sceneEdits: SceneEditCoordinator
  readonly applySnapping: (point: ScenePoint) => ScenePoint
  readonly render: (kind: 'scene' | 'viewport') => void
  readonly refreshSelectionDependent: () => void
  readonly beginDragPresentation: () => void
  readonly endDragPresentation: () => void
}

export interface ZoneControlPointController {
  refresh(enabled: boolean): void
  hide(): void
  pointerDown(context: ZoneControlPointPointerDownContext): SceneInteractionPointerDrag | null
  cancelActiveDrag(): boolean
  contains(target: EventTarget | null): boolean
  dispose(): void
}

interface ZoneControlPointPointerDownContext {
  readonly event: PointerEvent
  readonly rawWorld: ScenePoint
}

type ZoneControlPointKind =
  | 'line-endpoint'
  | 'polygon-vertex'
  | 'rect-corner'
  | 'ellipse-east'
  | 'ellipse-west'
  | 'ellipse-north'
  | 'ellipse-south'

interface ZoneControlPoint {
  readonly id: string
  readonly zoneId: string
  readonly kind: ZoneControlPointKind
  readonly index: number
  readonly world: ScenePoint
}

interface ActiveZoneControlPointDrag {
  readonly tx: SceneEditTransaction
  readonly zoneId: string
  readonly controlPoint: ZoneControlPoint
  readonly startZone: SceneZoneEntity
  readonly startScreen: ScenePoint
  changed: boolean
  movedPastDragThreshold: boolean
}

const CONTROL_POINT_HIT_SIZE_PX = 20
const CONTROL_POINT_MARK_SIZE_PX = 8
const CONTROL_POINT_Z_INDEX = 29
const CONTROL_POINT_DRAG_THRESHOLD_PX = 2
const MIN_ZONE_DIMENSION_M = 0.5
const MIN_POLYGON_AREA_M2 = 0.25
const GEOMETRY_EPSILON = 0.000001

export function createZoneControlPoints(
  options: ZoneControlPointOptions,
): ZoneControlPointController {
  const root = document.createElement('div')
  root.dataset.zoneControlPoints = 'true'
  root.style.cssText = [
    'position: absolute',
    'inset: 0',
    `z-index: ${CONTROL_POINT_Z_INDEX}`,
    'display: none',
    'pointer-events: none',
  ].join(';')
  options.container.appendChild(root)

  let activeDrag: ActiveZoneControlPointDrag | null = null
  let controlPoints = new Map<string, ZoneControlPoint>()

  function refresh(enabled: boolean): void {
    if (!enabled) {
      hide()
      return
    }

    const zone = eligibleSelectedZone()
    if (!zone) {
      hide()
      return
    }

    const nextControlPoints = createZoneControlPointsForZone(zone)
    if (nextControlPoints.length === 0) {
      hide()
      return
    }

    controlPoints = new Map(nextControlPoints.map((point) => [point.id, point]))
    root.replaceChildren(...nextControlPoints.map(createControlPointElement))
    root.style.display = 'block'
  }

  function hide(): void {
    root.replaceChildren()
    controlPoints = new Map()
    root.style.display = 'none'
  }

  function pointerDown({ event, rawWorld }: ZoneControlPointPointerDownContext): SceneInteractionPointerDrag | null {
    if (event.button !== 0) return null
    const element = closestControlPointElement(event.target)
    const controlPoint = element ? controlPoints.get(element.dataset.zoneControlPoint ?? '') : null
    if (!controlPoint) return null

    const zone = eligibleSelectedZone()
    if (!zone || zone.name !== controlPoint.zoneId) return null

    event.preventDefault()
    event.stopPropagation()
    activeDrag = {
      tx: options.sceneEdits.begin('interaction-zone-control-point'),
      zoneId: zone.name,
      controlPoint,
      startZone: cloneZone(zone),
      startScreen: options.camera.worldToScreen(rawWorld),
      changed: false,
      movedPastDragThreshold: false,
    }
    root.dataset.zoneControlPointActive = 'true'
    options.beginDragPresentation()

    return {
      update: updateDrag,
      commit: commitDrag,
    }
  }

  function updateDrag(context: SceneInteractionPointerEvent): void {
    const drag = activeDrag
    if (!drag) return
    if (
      !drag.movedPastDragThreshold
      && screenDistance(drag.startScreen, context.screen) <= CONTROL_POINT_DRAG_THRESHOLD_PX
    ) return
    drag.movedPastDragThreshold = true
    applyActiveDrag(context.rawWorld)
  }

  function commitDrag(context: SceneInteractionPointerEvent): void {
    const drag = activeDrag
    if (!drag) return
    const movedPastDragThreshold = drag.movedPastDragThreshold
      || screenDistance(drag.startScreen, context.screen) > CONTROL_POINT_DRAG_THRESHOLD_PX
    if (movedPastDragThreshold) applyActiveDrag(context.rawWorld)
    activeDrag = null
    delete root.dataset.zoneControlPointActive

    if (drag.changed && drag.tx.changed) {
      drag.tx.commit({ invalidate: 'scene' })
    } else {
      drag.tx.abort()
      options.render('scene')
    }
    options.endDragPresentation()
    options.refreshSelectionDependent()
  }

  function cancelActiveDrag(): boolean {
    const drag = activeDrag
    if (!drag) return false
    drag.tx.abort()
    activeDrag = null
    delete root.dataset.zoneControlPointActive
    options.render('scene')
    options.endDragPresentation()
    options.refreshSelectionDependent()
    return true
  }

  function applyActiveDrag(rawWorld: ScenePoint): void {
    const drag = activeDrag
    if (!drag) return
    const snapped = options.applySnapping(rawWorld)
    const nextZone = reshapeZone(drag.startZone, drag.controlPoint, snapped)
    if (!nextZone) return
    drag.changed = drag.changed || !zonesEqual(drag.startZone, nextZone)
    drag.tx.mutate((draft) => {
      draft.zones = draft.zones.map((zone) => (
        zone.name === drag.zoneId ? nextZone : zone
      ))
    })
    options.render('scene')
    options.refreshSelectionDependent()
  }

  function eligibleSelectedZone(): SceneZoneEntity | null {
    const selection = options.getSelection()
    if (
      selection.editableTargets.length !== 1
      || (selection.lockedTargets?.length ?? 0) > 0
      || selection.blockedTargets.length > 0
    ) return null
    const target = selection.editableTargets[0]
    if (target?.kind !== 'zone') return null
    return options.getSceneStore().persisted.zones.find((zone) => zone.name === target.id) ?? null
  }

  return {
    refresh,
    hide,
    pointerDown,
    cancelActiveDrag,
    contains(target) {
      return target instanceof Node && root.contains(target)
    },
    dispose() {
      cancelActiveDrag()
      root.remove()
    },
  }

  function createControlPointElement(point: ZoneControlPoint): HTMLElement {
    const screen = options.camera.worldToScreen(point.world)
    const handle = document.createElement('div')
    handle.dataset.zoneControlPoint = point.id
    handle.dataset.zoneControlPointKind = point.kind
    handle.dataset.zoneControlPointIndex = String(point.index)
    handle.dataset.zoneControlPointScreenX = String(screen.x)
    handle.dataset.zoneControlPointScreenY = String(screen.y)
    handle.setAttribute('role', 'button')
    handle.setAttribute('aria-label', `Zone control point ${point.index + 1}`)
    handle.style.cssText = [
      'position: absolute',
      `left: ${screen.x - CONTROL_POINT_HIT_SIZE_PX / 2}px`,
      `top: ${screen.y - CONTROL_POINT_HIT_SIZE_PX / 2}px`,
      `width: ${CONTROL_POINT_HIT_SIZE_PX}px`,
      `height: ${CONTROL_POINT_HIT_SIZE_PX}px`,
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'box-sizing: border-box',
      'border: 0',
      'border-radius: var(--radius-full)',
      'background: transparent',
      'cursor: grab',
      'pointer-events: auto',
      'touch-action: none',
      'user-select: none',
    ].join(';')

    const mark = document.createElement('span')
    mark.style.cssText = [
      `width: ${CONTROL_POINT_MARK_SIZE_PX}px`,
      `height: ${CONTROL_POINT_MARK_SIZE_PX}px`,
      'display: block',
      'border: 2px solid var(--color-surface)',
      'border-radius: var(--radius-full)',
      'background: var(--color-primary)',
      'box-sizing: border-box',
    ].join(';')
    handle.appendChild(mark)
    handle.addEventListener('pointerenter', () => {
      mark.style.transform = 'scale(1.35)'
    })
    handle.addEventListener('pointerleave', () => {
      mark.style.transform = ''
    })
    return handle
  }
}

function screenDistance(a: ScenePoint, b: ScenePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function closestControlPointElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest<HTMLElement>('[data-zone-control-point]')
}

function createZoneControlPointsForZone(zone: SceneZoneEntity): ZoneControlPoint[] {
  if (zone.zoneType === 'line' && zone.points.length >= 2) {
    return zone.points.slice(0, 2).map((point, index) => ({
      id: `${zone.name}:line:${index}`,
      zoneId: zone.name,
      kind: 'line-endpoint',
      index,
      world: point,
    }))
  }

  if (zone.zoneType === 'polygon' && zone.points.length >= 3) {
    return zone.points.map((point, index) => ({
      id: `${zone.name}:polygon:${index}`,
      zoneId: zone.name,
      kind: 'polygon-vertex',
      index,
      world: point,
    }))
  }

  if (zone.zoneType === 'rect') {
    const corners = getRectangularZoneCorners(zone)
    return corners?.map((point, index) => ({
      id: `${zone.name}:rect:${index}`,
      zoneId: zone.name,
      kind: 'rect-corner',
      index,
      world: point,
    })) ?? []
  }

  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const center = zone.points[0]!
    const radii = zone.points[1]!
    return [
      {
        id: `${zone.name}:ellipse:east`,
        zoneId: zone.name,
        kind: 'ellipse-east',
        index: 0,
        world: offsetRotated(center, { x: Math.abs(radii.x), y: 0 }, zone.rotationDeg),
      },
      {
        id: `${zone.name}:ellipse:west`,
        zoneId: zone.name,
        kind: 'ellipse-west',
        index: 1,
        world: offsetRotated(center, { x: -Math.abs(radii.x), y: 0 }, zone.rotationDeg),
      },
      {
        id: `${zone.name}:ellipse:north`,
        zoneId: zone.name,
        kind: 'ellipse-north',
        index: 2,
        world: offsetRotated(center, { x: 0, y: -Math.abs(radii.y) }, zone.rotationDeg),
      },
      {
        id: `${zone.name}:ellipse:south`,
        zoneId: zone.name,
        kind: 'ellipse-south',
        index: 3,
        world: offsetRotated(center, { x: 0, y: Math.abs(radii.y) }, zone.rotationDeg),
      },
    ]
  }

  return []
}

function reshapeZone(
  zone: SceneZoneEntity,
  controlPoint: ZoneControlPoint,
  dragged: ScenePoint,
): SceneZoneEntity | null {
  if (zone.zoneType === 'line') return reshapeLinearZone(zone, controlPoint.index, dragged)
  if (zone.zoneType === 'polygon') return reshapePolygonalZone(zone, controlPoint.index, dragged)
  if (zone.zoneType === 'rect') return reshapeRectangularZone(zone, controlPoint.index, dragged)
  if (zone.zoneType === 'ellipse') return reshapeEllipticalZone(zone, controlPoint.kind, dragged)
  return null
}

function reshapeLinearZone(zone: SceneZoneEntity, index: number, dragged: ScenePoint): SceneZoneEntity | null {
  if (zone.points.length < 2 || index < 0 || index > 1) return null
  const points = zone.points.map((point, pointIndex) => (
    pointIndex === index ? cleanPoint(dragged) : { ...point }
  ))
  if (distance(points[0]!, points[1]!) < MIN_ZONE_DIMENSION_M) return null
  return { ...zone, points }
}

function reshapePolygonalZone(zone: SceneZoneEntity, index: number, dragged: ScenePoint): SceneZoneEntity | null {
  if (zone.points.length < 3 || index < 0 || index >= zone.points.length) return null
  const points = zone.points.map((point, pointIndex) => (
    pointIndex === index ? cleanPoint(dragged) : { ...point }
  ))
  if (Math.abs(polygonArea(points)) < MIN_POLYGON_AREA_M2) return null
  return { ...zone, points, rotationDeg: 0 }
}

function reshapeRectangularZone(zone: SceneZoneEntity, index: number, dragged: ScenePoint): SceneZoneEntity | null {
  const corners = getRectangularZoneCorners(zone)
  if (!corners || index < 0 || index >= 4) return null
  const anchor = corners[(index + 2) % 4]!
  const localDelta = rotateVector({
    x: dragged.x - anchor.x,
    y: dragged.y - anchor.y,
  }, -zone.rotationDeg)
  const width = Math.abs(localDelta.x)
  const height = Math.abs(localDelta.y)
  if (width < MIN_ZONE_DIMENSION_M || height < MIN_ZONE_DIMENSION_M) return null
  return {
    ...zone,
    points: rectPointsAroundCenter(midpoint(anchor, dragged), width, height),
  }
}

function reshapeEllipticalZone(
  zone: SceneZoneEntity,
  kind: ZoneControlPointKind,
  dragged: ScenePoint,
): SceneZoneEntity | null {
  if (zone.points.length < 2) return null
  const center = zone.points[0]!
  const radii = zone.points[1]!
  const xAxis = rotateVector({ x: 1, y: 0 }, zone.rotationDeg)
  const yAxis = rotateVector({ x: 0, y: 1 }, zone.rotationDeg)

  if (kind === 'ellipse-east' || kind === 'ellipse-west') {
    const direction = kind === 'ellipse-east' ? 1 : -1
    const anchor = {
      x: center.x - xAxis.x * direction * Math.abs(radii.x),
      y: center.y - xAxis.y * direction * Math.abs(radii.x),
    }
    const projected = projectPointOnAxisFromAnchor(anchor, dragged, xAxis)
    const radius = Math.abs(projected.distanceAlongAxis) / 2
    if (radius < MIN_ZONE_DIMENSION_M / 2) return null
    return {
      ...zone,
      points: [
        cleanPoint(projected.center),
        { x: cleanMetric(radius), y: Math.abs(radii.y) },
      ],
    }
  }

  if (kind === 'ellipse-north' || kind === 'ellipse-south') {
    const direction = kind === 'ellipse-south' ? 1 : -1
    const anchor = {
      x: center.x - yAxis.x * direction * Math.abs(radii.y),
      y: center.y - yAxis.y * direction * Math.abs(radii.y),
    }
    const projected = projectPointOnAxisFromAnchor(anchor, dragged, yAxis)
    const radius = Math.abs(projected.distanceAlongAxis) / 2
    if (radius < MIN_ZONE_DIMENSION_M / 2) return null
    return {
      ...zone,
      points: [
        cleanPoint(projected.center),
        { x: Math.abs(radii.x), y: cleanMetric(radius) },
      ],
    }
  }

  return null
}

function projectPointOnAxisFromAnchor(
  anchor: ScenePoint,
  point: ScenePoint,
  axis: ScenePoint,
): { center: ScenePoint; distanceAlongAxis: number } {
  const distanceAlongAxis = dot({ x: point.x - anchor.x, y: point.y - anchor.y }, axis)
  return {
    distanceAlongAxis,
    center: {
      x: anchor.x + axis.x * distanceAlongAxis / 2,
      y: anchor.y + axis.y * distanceAlongAxis / 2,
    },
  }
}

function offsetRotated(center: ScenePoint, offset: ScenePoint, degrees: number): ScenePoint {
  const rotated = rotateVector(offset, degrees)
  return {
    x: cleanMetric(center.x + rotated.x),
    y: cleanMetric(center.y + rotated.y),
  }
}

function rotateVector(vector: ScenePoint, degrees: number): ScenePoint {
  const radians = degrees * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: cleanMetric(vector.x * cos - vector.y * sin),
    y: cleanMetric(vector.x * sin + vector.y * cos),
  }
}

function rectPointsAroundCenter(center: ScenePoint, width: number, height: number): ScenePoint[] {
  const halfWidth = width / 2
  const halfHeight = height / 2
  return [
    { x: cleanMetric(center.x - halfWidth), y: cleanMetric(center.y - halfHeight) },
    { x: cleanMetric(center.x + halfWidth), y: cleanMetric(center.y - halfHeight) },
    { x: cleanMetric(center.x + halfWidth), y: cleanMetric(center.y + halfHeight) },
    { x: cleanMetric(center.x - halfWidth), y: cleanMetric(center.y + halfHeight) },
  ]
}

function cloneZone(zone: SceneZoneEntity): SceneZoneEntity {
  return {
    ...zone,
    points: zone.points.map((point) => ({ ...point })),
  }
}

function zonesEqual(a: SceneZoneEntity, b: SceneZoneEntity): boolean {
  if (a.rotationDeg !== b.rotationDeg || a.points.length !== b.points.length) return false
  return a.points.every((point, index) => pointsEqual(point, b.points[index]!))
}

function pointsEqual(a: ScenePoint, b: ScenePoint): boolean {
  return Math.abs(a.x - b.x) < GEOMETRY_EPSILON
    && Math.abs(a.y - b.y) < GEOMETRY_EPSILON
}

function cleanPoint(point: ScenePoint): ScenePoint {
  return {
    x: cleanMetric(point.x),
    y: cleanMetric(point.y),
  }
}

function midpoint(a: ScenePoint, b: ScenePoint): ScenePoint {
  return {
    x: cleanMetric((a.x + b.x) / 2),
    y: cleanMetric((a.y + b.y) / 2),
  }
}

function distance(a: ScenePoint, b: ScenePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function polygonArea(points: readonly ScenePoint[]): number {
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    sum += current.x * next.y - next.x * current.y
  }
  return sum / 2
}

function dot(a: ScenePoint, b: ScenePoint): number {
  return a.x * b.x + a.y * b.y
}

function cleanMetric(value: number): number {
  return Math.abs(value) < GEOMETRY_EPSILON ? 0 : value
}
