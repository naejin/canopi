// canvas/runtime/tools/zone-drag.ts
//
// Owns the drag-to-draw tools, Line, Rectangle and Ellipse, and the drag they share with Measure
// (tools/measurement-guide.ts). A press opens one Scene Edit at the snapped point and draws the zero-size shape; each drag
// point redraws the draft between the drag's start, which the host keeps on the ground (plan §1, exception 1), and the
// snapped pointer, with its measure chips (tools/measure-labels.ts); the release adds the object and selects it in that
// edit, and a cancel, a tool change or a closed layer aborts it. Rectangles and ellipses are world boxes until phase 1
// (INV-TOOL-03), and Shift does nothing here until phase 2. A release that adds nothing aborts its edit, as today's
// cancellation after every pointerup did; a release whose commit throws leaves the edit to the host's cancellation after
// the failed release, whose abort retries the commit; an abort that fails keeps the drag for the host's retry before the
// next event.

import { computeSelectionRect } from '../../operations'
import type { ToolId } from '../interaction-types'
import type { SceneDesignObjectTarget } from '../scene/design-object-targets'
import type { ScenePersistedState } from '../scene/types'
import type { SceneEditTransaction } from '../scene-runtime/transactions'
import type { WorldPoint } from '../view/types'
import {
  createEllipticalZoneMeasurementsFromRect,
  createLinearZoneMeasurements,
  createRectangularZoneMeasurementsFromRect,
  type ZoneMeasurementLabel,
} from '../zone-measurements'
import type { DraftFill, DraftShape, DraftStroke } from './draft'
import { measureLabelShapes } from './measure-labels'
import type { CanvasTool, SceneLayerKind, ToolContext, ToolGesture, ToolReply } from './tool'
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
  /** The shape between the snapped start and end. */
  shape(start: WorldPoint, end: WorldPoint): DraftShape
  /** Its measurements; none for a shape too small to measure (the press's zero-size shape). */
  measure(start: WorldPoint, end: WorldPoint): readonly ZoneMeasurementLabel[]
  /** The edit a release at `end` makes, returning the object to select; null when the shape is too small to keep. */
  place(start: WorldPoint, end: WorldPoint): ((draft: ScenePersistedState) => SceneDesignObjectTarget | null) | null
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
    shape(start, end) {
      const rect = computeSelectionRect(start, end)
      return {
        kind: 'polygon',
        points: [
          { x: rect.x, y: rect.y },
          { x: rect.x + rect.width, y: rect.y },
          { x: rect.x + rect.width, y: rect.y + rect.height },
          { x: rect.x, y: rect.y + rect.height },
        ],
        style: DRAFT_STROKE,
        fill: ZONE_DRAFT_FILL,
      }
    },
    measure: (start, end) => createRectangularZoneMeasurementsFromRect(computeSelectionRect(start, end)),
    place(start, end) {
      const rect = computeSelectionRect(start, end)
      if (isTooSmall(rect)) return null
      return (draft) => zoneTarget(appendRectangleZoneToDraft(draft, rect))
    },
  },
  ellipse: {
    id: 'ellipse',
    layer: 'zones',
    editType: 'interaction-ellipse',
    shape(start, end) {
      const rect = computeSelectionRect(start, end)
      return {
        kind: 'ellipse',
        center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        radiusX: rect.width / 2,
        radiusY: rect.height / 2,
        rotationDeg: 0,
        style: DRAFT_STROKE,
        fill: ZONE_DRAFT_FILL,
      }
    },
    measure: (start, end) => createEllipticalZoneMeasurementsFromRect(computeSelectionRect(start, end)),
    place(start, end) {
      const rect = computeSelectionRect(start, end)
      if (isTooSmall(rect)) return null
      return (draft) => zoneTarget(appendEllipseZoneToDraft(draft, rect))
    },
  },
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
    const chips = measureLabelShapes(spec.measure(current.start, current.end), (a, b) => view.screenDistance(a, b))
    effects.setDraft({ shapes: [spec.shape(current.start, current.end), ...chips] })
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
    // A commit that throws keeps the drag: the host's cancellation after the failed release aborts it, retrying the commit.
    commit(current, end)
    if (drag === current) cancelDrag()
    else clearDraft()
  }

  /** Adds the shape and selects it in the drag's edit; a closed layer or a shape too small leaves it to the abort. */
  function commit(current: ActiveDrag, end: WorldPoint): void {
    if (!context().scene.isLayerOpenForCreation(spec.layer)) return
    const place = spec.place(current.start, end)
    if (!place) return
    let target = null as SceneDesignObjectTarget | null
    current.edit.mutate((draft) => {
      target = place(draft)
    })
    if (target) current.edit.setSelection([target])
    current.edit.commit()
    drag = null
  }

  /** Aborts the drag's edit; one that fails to abort stays for the host's retry. The draft goes either way. */
  function cancelDrag(): void {
    const current = drag
    if (!current) return
    try {
      current.edit.abort()
      if (drag === current) drag = null
    } finally {
      clearDraft()
    }
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
    planeChanged(reproject) {
      if (!drag) return
      drag.start = reproject(drag.start)
      drag.end = reproject(drag.end)
      draw(drag)
    },
    viewChanged() {
      if (drag && drawn) draw(drag)
    },
    // Esc during the drag is the live gesture's layer (the host's), then the tool's.
    hasTransient: () => false,
    escapeHint: () => 'leave-tool',
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
