// canvas/runtime/tools/zone-drag.ts
//
// Owns the drag-to-draw tools, Line, Rectangle and Ellipse, and the drag they share with Measure
// (tools/measurement-guide.ts). A press opens one Scene Edit at the snapped point and draws the zero-size shape; each drag
// point redraws the draft between the drag's start, which the host keeps on the ground (plan §1, exception 1), and the
// snapped pointer, with its measure chips (tools/measure-labels.ts); the release adds the object and selects it in that
// edit, and a cancel, a tool change or a closed layer aborts it. Rectangles and ellipses are level with the screen
// (ToolView.screenAlignedRect, INV-TOOL-03): the zone stores the unturned box about its centre and the bearing as its
// rotationDeg, so at bearing 0 they are today's world boxes. Shift does nothing here until phase 2. A release that adds
// nothing aborts its edit, as today's cancellation after every pointerup did; a release that throws is the host's fault
// rule's (spec §1.4 "Faults").

import type { ToolId } from '../interaction-types'
import type { SceneDesignObjectTarget } from '../scene/design-object-targets'
import type { ScenePersistedState } from '../scene/types'
import type { SceneEditTransaction } from '../scene-runtime/transactions'
import type { WorldPoint } from '../view/types'
import {
  createEllipticalZoneMeasurements,
  createLinearZoneMeasurements,
  createRectangularZoneMeasurements,
  type ZoneMeasurementLabel,
} from '../zone-measurements'
import type { DraftFill, DraftShape, DraftStroke } from './draft'
import { measureLabelShapes } from './measure-labels'
import type { CanvasTool, SceneLayerKind, ToolContext, ToolGesture, ToolReply, ToolView } from './tool'
import { appendEllipseZoneToDraft, appendLineZoneToDraft, appendRectangleZoneToDraft } from './tool-actions'

/** Today's draft line: 2 px in the guide-line colour, on the overlay casing. */
export const DRAFT_STROKE: DraftStroke = Object.freeze({ token: 'draft', widthPx: 2 })
/** Today's zone draft fill (--canvas-zone-fill). */
export const ZONE_DRAFT_FILL: DraftFill = Object.freeze({ token: 'draft-fill' })

export type ZoneDragKind = 'line' | 'rectangle' | 'ellipse'

/** What one drag-to-draw tool draws and adds. */
export interface DragShapeSpec {
  readonly id: ToolId
  /** The layer the object lands on: a press on a closed layer draws nothing, and a release there adds nothing. */
  readonly layer: SceneLayerKind
  /** The Scene Edit of one drag. */
  readonly editType: string
  /** The shape between the snapped start and end; `view` is the current frame's (screen-aligned boxes read it). */
  shape(start: WorldPoint, end: WorldPoint, view: ToolView): DraftShape
  /** Its measurements; none for a shape too small to measure (the press's zero-size shape). */
  measure(start: WorldPoint, end: WorldPoint, view: ToolView): readonly ZoneMeasurementLabel[]
  /** The edit a release at `end` makes, returning the object to select; null when the shape is too small to keep. */
  place(
    start: WorldPoint,
    end: WorldPoint,
    view: ToolView,
  ): ((draft: ScenePersistedState) => SceneDesignObjectTarget | null) | null
}

interface ActiveDrag {
  start: WorldPoint
  end: WorldPoint
  readonly edit: SceneEditTransaction
}

export function createZoneDragTool(kind: ZoneDragKind): CanvasTool {
  return createDragShapeTool(ZONE_DRAGS[kind])
}

const ZONE_DRAGS: Readonly<Record<ZoneDragKind, DragShapeSpec>> = {
  line: {
    id: 'line',
    layer: 'zones',
    editType: 'interaction-line',
    shape: (start, end) => ({ kind: 'polyline', points: [start, end], style: DRAFT_STROKE }),
    measure: createLinearZoneMeasurements,
    place: (start, end) => (draft) => zoneTarget(appendLineZoneToDraft(draft, start, end)),
  },
  rectangle: {
    id: 'rectangle',
    layer: 'zones',
    editType: 'interaction-rectangle',
    shape: (start, end, view) => ({
      kind: 'polygon',
      points: boxCorners(view.screenAlignedRect(start, end)),
      style: DRAFT_STROKE,
      fill: ZONE_DRAFT_FILL,
    }),
    measure(start, end, view) {
      const box = view.screenAlignedRect(start, end)
      return isTooSmall(box) ? [] : createRectangularZoneMeasurements(boxCorners(box))
    },
    place(start, end, view) {
      const box = view.screenAlignedRect(start, end)
      if (isTooSmall(box)) return null
      return (draft) => zoneTarget(appendRectangleZoneToDraft(draft, unturnedRect(box), box.rotationDeg))
    },
  },
  ellipse: {
    id: 'ellipse',
    layer: 'zones',
    editType: 'interaction-ellipse',
    shape(start, end, view) {
      const box = view.screenAlignedRect(start, end)
      return {
        kind: 'ellipse',
        center: box.center,
        radiusX: box.width / 2,
        radiusY: box.height / 2,
        rotationDeg: box.rotationDeg,
        style: DRAFT_STROKE,
        fill: ZONE_DRAFT_FILL,
      }
    },
    measure(start, end, view) {
      const box = view.screenAlignedRect(start, end)
      return createEllipticalZoneMeasurements(box.center, { x: box.width / 2, y: box.height / 2 }, box.rotationDeg)
    },
    place(start, end, view) {
      const box = view.screenAlignedRect(start, end)
      if (isTooSmall(box)) return null
      return (draft) => zoneTarget(appendEllipseZoneToDraft(draft, unturnedRect(box), box.rotationDeg))
    },
  },
}

/** ToolView.screenAlignedRect's box. */
type ScreenAlignedBox = ReturnType<ToolView['screenAlignedRect']>

/** The box before its turn: what the zone stores, its rotationDeg turning it about the centre. */
function unturnedRect(box: ScreenAlignedBox): { x: number; y: number; width: number; height: number } {
  return { x: box.center.x - box.width / 2, y: box.center.y - box.height / 2, width: box.width, height: box.height }
}

/** The box's corners in a rectangle zone's order, turned about the centre as zone-geometry.ts turns a stored rectangle. */
function boxCorners(box: ScreenAlignedBox): WorldPoint[] {
  const { center, width, height } = box
  const radians = (box.rotationDeg * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const dx = (sx! * width) / 2
    const dy = (sy! * height) / 2
    return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
  })
}

/** A drag-to-draw tool: one Scene Edit from the press to the release. */
export function createDragShapeTool(spec: DragShapeSpec): CanvasTool {
  let ctx: ToolContext | null = null
  let drag: ActiveDrag | null = null
  let drawn = false

  function context(): ToolContext {
    if (!ctx) throw new Error(`The ${spec.id} tool is not active`)
    return ctx
  }

  function draw(current: ActiveDrag): void {
    const { view, effects } = context()
    const chips = measureLabelShapes(spec.measure(current.start, current.end, view), (a, b) => view.screenDistance(a, b))
    effects.setDraft({ shapes: [spec.shape(current.start, current.end, view), ...chips] })
    drawn = true
  }

  function clearDraft(): void {
    if (!drawn) return
    drawn = false
    context().effects.setDraft(null)
  }

  function begin(at: WorldPoint): void {
    const { scene, effects } = context()
    if (!scene.isLayerOpenForCreation(spec.layer)) return
    let next!: ActiveDrag
    const edit = effects.edits.begin(spec.editType, {
      // The draft goes when the edit commits, which a retained publication may do later.
      onCommitted: () => {
        if (drag === next) clearDraft()
      },
    })
    next = { start: at, end: at, edit }
    drag = next
    draw(next)
  }

  function update(start: WorldPoint, end: WorldPoint): void {
    if (!drag) return
    drag.start = start
    drag.end = end
    draw(drag)
  }

  function release(end: WorldPoint): void {
    const current = drag
    if (!current) return
    commit(current, end)
    if (drag === current) cancelDrag()
    else clearDraft()
  }

  /** Adds the shape and selects it in the drag's edit; a closed layer or a shape too small leaves it to the abort. */
  function commit(current: ActiveDrag, end: WorldPoint): void {
    const { scene, view } = context()
    if (!scene.isLayerOpenForCreation(spec.layer)) return
    const place = spec.place(current.start, end, view)
    if (!place) return
    let target = null as SceneDesignObjectTarget | null
    current.edit.mutate((draft) => {
      target = place(draft)
    })
    if (target) current.edit.setSelection([target])
    current.edit.commit()
    drag = null
  }

  /** Aborts the drag's edit and clears its draft. */
  function cancelDrag(): void {
    const current = drag
    if (!current) return
    current.edit.abort()
    drag = null
    clearDraft()
  }

  return {
    id: spec.id,
    activate(next) {
      ctx = next
      drag = null
      drawn = false
    },
    gesture(g: ToolGesture): ToolReply {
      switch (g.kind) {
        case 'press':
          begin(g.point.snapped)
          return 'handled'
        case 'drag-start':
        case 'drag-move':
          update(g.start.snapped, g.point.snapped)
          return 'handled'
        case 'drag-end':
          if (drag) drag.start = g.start.snapped
          release(g.point.snapped)
          return 'handled'
        case 'tap':
          release(g.point.snapped)
          return 'handled'
        case 'cancel':
          cancelDrag()
          return 'handled'
        default:
          return 'pass'
      }
    },
    command: () => 'pass',
    viewChanged() {
      if (drag && drawn) draw(drag)
    },
    // Esc during the drag is the live gesture's layer (the host's), then the tool's.
    hasTransient: () => false,
    cancelTransient() {
      cancelDrag()
    },
    deactivate() {
      cancelDrag()
    },
  }
}

function zoneTarget(id: string | null): SceneDesignObjectTarget | null {
  return id ? { kind: 'zone', id } : null
}

/** Today's minimum: a rectangle or an ellipse narrower than half a metre either way is dropped. */
function isTooSmall(rect: { readonly width: number; readonly height: number }): boolean {
  return rect.width < 0.5 || rect.height < 0.5
}
