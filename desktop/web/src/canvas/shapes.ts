import Konva from 'konva'
import { getCanvasColor } from './theme-refresh'

function generateId(): string {
  return crypto.randomUUID()
}

// Style constants — zone/annotation colors are read from the theme-refresh cache
// so newly created shapes match the active theme. Stroke width is theme-independent.
const ZONE_STROKE_WIDTH = 2          // screen pixels — constant because strokeScaleEnabled: false

export const PREVIEW_DASH = [6, 3]

export interface ShapeDefaults {
  fill: string
  stroke: string
  strokeWidth: number
}

export function zoneDefaults(): ShapeDefaults {
  return {
    fill: getCanvasColor('zone-fill'),
    stroke: getCanvasColor('zone-stroke'),
    strokeWidth: ZONE_STROKE_WIDTH,
  }
}

export function createRect(attrs: {
  x: number
  y: number
  width: number
  height: number
}): Konva.Rect {
  return new Konva.Rect({
    ...attrs,
    id: generateId(),
    fill: getCanvasColor('zone-fill'),
    stroke: getCanvasColor('zone-stroke'),
    strokeWidth: ZONE_STROKE_WIDTH,
    strokeScaleEnabled: false,
    draggable: true,
    name: 'shape',
    'data-theme-managed-fill': true,
  })
}

export function createEllipse(attrs: {
  x: number
  y: number
  radiusX: number
  radiusY: number
}): Konva.Ellipse {
  return new Konva.Ellipse({
    ...attrs,
    id: generateId(),
    fill: getCanvasColor('zone-fill'),
    stroke: getCanvasColor('zone-stroke'),
    strokeWidth: ZONE_STROKE_WIDTH,
    strokeScaleEnabled: false,
    draggable: true,
    name: 'shape',
    'data-theme-managed-fill': true,
  })
}

export function createPolygon(points: number[]): Konva.Line {
  return new Konva.Line({
    points,
    id: generateId(),
    fill: getCanvasColor('zone-fill'),
    stroke: getCanvasColor('zone-stroke'),
    strokeWidth: ZONE_STROKE_WIDTH,
    strokeScaleEnabled: false,
    closed: true,
    draggable: true,
    name: 'shape',
    'data-theme-managed-fill': true,
  })
}

export function createFreeform(points: number[], closed: boolean): Konva.Line {
  return new Konva.Line({
    points,
    id: generateId(),
    fill: closed ? getCanvasColor('zone-fill') : undefined,
    stroke: getCanvasColor('zone-stroke'),
    strokeWidth: ZONE_STROKE_WIDTH,
    strokeScaleEnabled: false,
    closed,
    draggable: true,
    name: 'shape',
    tension: 0.3,
    'data-theme-managed-fill': closed,
  })
}

export function createPolyline(points: number[]): Konva.Line {
  return new Konva.Line({
    points,
    id: generateId(),
    stroke: getCanvasColor('annotation-stroke'),
    strokeWidth: 2,
    strokeScaleEnabled: false,
    draggable: true,
    name: 'shape',
  })
}

export function createText(attrs: {
  x: number
  y: number
  text: string
}): Konva.Text {
  // fontSize 16 is in screen pixels — caller must counter-scale with 1/stageScale
  // so the text stays at a constant 16px visual size regardless of zoom.
  return new Konva.Text({
    ...attrs,
    id: generateId(),
    fontSize: 16,
    fontFamily: 'Inter, sans-serif',
    fill: getCanvasColor('annotation-text'),
    draggable: true,
    name: 'shape annotation-text',
  })
}

// Measurement line — solid, annotation colour.
export function createMeasureLine(points: number[]): Konva.Line {
  return new Konva.Line({
    points,
    id: generateId(),
    stroke: getCanvasColor('annotation-stroke'),
    strokeWidth: 1.5,
    strokeScaleEnabled: false,
    name: 'shape',
  })
}

// Label pill group for measurements: background rect + text, pre-positioned.
// Caller must set position on the returned group.
// fontSize is in screen pixels — caller must counter-scale the group with
// 1/stageScale so the pill stays at a constant visual size regardless of zoom.
export function createMeasureLabel(text: string): Konva.Group {
  const label = new Konva.Text({
    text,
    fontSize: 12,
    fontFamily: 'Inter, sans-serif',
    fill: getCanvasColor('annotation-surface'),
    padding: 4,
  })

  const w = label.width()
  const h = label.height()

  const pill = new Konva.Rect({
    x: -w / 2 - 4,
    y: -h / 2,
    width: w + 8,
    height: h,
    fill: getCanvasColor('annotation-stroke'),
    cornerRadius: 4,
  })

  // Re-centre the text over the pill
  label.x(-w / 2)
  label.y(-h / 2)

  const group = new Konva.Group({ name: 'measure-label' })  // NO 'shape' — parent measure group is the selectable entity
  group.add(pill)
  group.add(label)
  return group
}

/**
 * Counter-scale all annotation nodes (measure label groups, text nodes) so they
 * stay at a fixed screen-pixel size regardless of zoom.
 * Called on every zoom change alongside updatePlantsLOD.
 */
export function updateAnnotationsForZoom(annotationsLayer: Konva.Layer, stageScale: number): void {
  const inv = 1 / stageScale

  // Counter-scale measure label groups (pill + text inside a Group with name 'measure-label')
  annotationsLayer.find('.measure-label').forEach((node: Konva.Node) => {
    node.scale({ x: inv, y: inv })
  })

  // Counter-scale standalone text nodes created by the text tool
  annotationsLayer.find('.annotation-text').forEach((node: Konva.Node) => {
    node.scale({ x: inv, y: inv })
  })

  annotationsLayer.batchDraw()
}
