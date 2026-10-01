// canvas/runtime/tools/polygon.ts
//
// Owns the Polygon tool. Each press adds a corner at the snapped point (with Shift the new edge turns to a 45° step from
// the last corner through the host's constraint, which under LEGACY snaps first, spec §2.3); a press within 8 px of the
// first corner closes a shape of 3 or more, tested on ToolPoint.free (today's snap(raw)), and Enter finishes it, in one
// Scene Edit that selects the new zone. Hovers, and the drag after a press, move the rubber band and add nothing. The
// first corner clears the selection without an undo step. Backspace and Edit › Undo take the last corner back onto a redo
// stack (transient history, no Scene Edit); Esc drops the draft and its redo; an interruption ('navigate') keeps them while
// the draft has corners and drops a redo-only history, as today; overview, a tool change or a document replacement drops
// them, and a re-origin moves them through lon/lat.
// The draft is a fill-only polygon of the corners, the rubber band, a disc per corner and the edge and area chips
// (tools/measure-labels.ts), whose edge chips re-cull on every camera frame.

import type { WorldPoint } from '../view/types'
import { createPolygonalZoneDraftMeasurements } from '../zone-measurements'
import type { DraftShape, DraftStroke } from './draft'
import { measureLabelShapes } from './measure-labels'
import type { CanvasTool, ToolCommand, ToolContext, ToolGesture, ToolPoint, ToolReply, ToolView } from './tool'
import { appendPolygonZoneToDraft } from './tool-actions'
import { DRAFT_STROKE, ZONE_DRAFT_FILL } from './zone-drag'

/** A press this close to the first corner, on screen, closes the shape. */
const CLOSE_DISTANCE_PX = 8
/** A press on the last corner moves the rubber band only. */
const SAME_CORNER_M = 0.0001
/** The corners' fill carries no stroke: the rubber band draws the edges. */
const FILL_ONLY: DraftStroke = Object.freeze({ token: 'draft', widthPx: 0 })
/** A light disc of radius 3.5 px on a 1 px casing ring (plan §1, exception 2). */
const CORNER_MARKER = Object.freeze({ radiusPx: 1.75, style: Object.freeze({ token: 'draft', widthPx: 3.5 }) as DraftStroke })

export function createPolygonTool(): CanvasTool {
  let ctx: ToolContext | null = null
  let corners: WorldPoint[] = []
  let redo: WorldPoint[] = []
  /** Where the rubber band ends: the pointer, or the last corner placed. */
  let active: WorldPoint | null = null
  let drawn = false

  function context(): ToolContext {
    if (!ctx) throw new Error('The polygon tool is not active')
    return ctx
  }

  function hasTransient(): boolean {
    return corners.length > 0 || redo.length > 0
  }

  function redraw(): void {
    const { effects, view } = context()
    effects.setGuidance({ gesture: corners.length > 0 })
    if (corners.length === 0) {
      if (!drawn) return
      drawn = false
      effects.setDraft(null)
      return
    }
    drawn = true
    effects.setDraft({ shapes: draftShapes(corners, active, view) })
  }

  function press(point: ToolPoint): void {
    const { scene, effects } = context()
    if (!scene.isLayerOpenForCreation('zones')) {
      drop()
      return
    }
    if (closesAt(point.free)) {
      finish()
      return
    }
    const corner = point.snapped
    const last = corners[corners.length - 1]
    if (last && isSamePoint(last, corner)) {
      active = corner
      redraw()
      return
    }
    if (corners.length === 0 && scene.selection().length > 0) effects.setSelection([])
    corners = [...corners, corner]
    redo = []
    active = corner
    redraw()
  }

  function closesAt(point: WorldPoint): boolean {
    if (corners.length < 3) return false
    return context().view.screenDistance(corners[0]!, point) <= CLOSE_DISTANCE_PX
  }

  /** One Scene Edit adds the zone and selects it; the draft goes once it commits. Fewer than 3 corners wait. */
  function finish(): void {
    if (corners.length < 3) return
    const { scene, effects } = context()
    if (!scene.isLayerOpenForCreation('zones')) {
      drop()
      return
    }
    const shape = corners
    effects.edits.run('interaction-polygon', (tx) => {
      let zoneId: string | null = null
      tx.mutate((draft) => {
        zoneId = appendPolygonZoneToDraft(draft, shape)
      })
      if (zoneId) tx.setSelection([{ kind: 'zone', id: zoneId }])
    }, {
      onCommitted: () => drop(),
    })
  }

  function undo(): boolean {
    const removed = corners[corners.length - 1]
    if (!removed) return false
    redo = [...redo, removed]
    corners = corners.slice(0, -1)
    if (corners.length === 0) active = null
    redraw()
    return true
  }

  function redoCorner(): boolean {
    const restored = redo[redo.length - 1]
    if (!restored) return false
    redo = redo.slice(0, -1)
    corners = [...corners, restored]
    if (active === null) active = restored
    redraw()
    return true
  }

  function drop(): void {
    corners = []
    redo = []
    active = null
    redraw()
  }

  /** The rubber band follows the pointer while a draft is open; the passive hover waits. */
  function follow(point: ToolPoint): ToolReply {
    if (corners.length === 0) return 'pass'
    active = point.snapped
    redraw()
    return 'handled'
  }

  return {
    id: 'polygon',
    preservesTransientOnNavigate: true,
    constraint() {
      const last = corners[corners.length - 1]
      return last ? { kind: 'direction', origin: last, stepDeg: 45 } : null
    },
    activate(next) {
      ctx = next
      corners = []
      redo = []
      active = null
      drawn = false
    },
    gesture(g: ToolGesture): ToolReply {
      switch (g.kind) {
        case 'press':
          press(g.point)
          return 'handled'
        case 'hover':
        case 'drag-start':
        case 'drag-move':
          return follow(g.point)
        // The press added the corner: a tap or a drag's end adds nothing, and a cancel keeps the draft.
        default:
          return 'pass'
      }
    },
    command(c: ToolCommand): ToolReply {
      switch (c.kind) {
        case 'confirm':
          if (corners.length === 0) return 'pass'
          finish()
          return 'handled'
        case 'remove-last':
        case 'undo-transient':
          return undo() ? 'handled' : 'pass'
        case 'redo-transient':
          return redoCorner() ? 'handled' : 'pass'
        case 'escape':
          if (!hasTransient()) return 'pass'
          drop()
          return 'handled'
        default:
          return 'pass'
      }
    },
    planeChanged(reproject) {
      corners = corners.map(reproject)
      redo = redo.map(reproject)
      if (active) active = reproject(active)
      if (corners.length > 0) redraw()
    },
    viewChanged() {
      if (corners.length > 0) redraw()
    },
    hasTransient,
    escapeHint: () => hasTransient() ? 'drop-transient' : 'leave-tool',
    cancelTransient(reason) {
      // An interruption keeps the draft only while it has corners (today's hasPolygonDraft): a redo-only history goes.
      if (reason === 'navigate' && corners.length > 0) return
      if (hasTransient()) drop()
    },
    canUndoTransient: () => corners.length > 0,
    canRedoTransient: () => redo.length > 0,
    deactivate() {
      if (hasTransient()) drop()
    },
  }
}

function draftShapes(corners: readonly WorldPoint[], active: WorldPoint | null, view: ToolView): DraftShape[] {
  const shapes: DraftShape[] = []
  if (corners.length >= 3) shapes.push({ kind: 'polygon', points: corners, style: FILL_ONLY, fill: ZONE_DRAFT_FILL })
  const band = active ? [...corners, active] : corners
  if (band.length >= 2) shapes.push({ kind: 'polyline', points: band, style: DRAFT_STROKE })
  for (const center of corners) shapes.push({ kind: 'circle-px', center, ...CORNER_MARKER })
  const chips = createPolygonalZoneDraftMeasurements(corners, active)
  shapes.push(...measureLabelShapes(chips, (a, b) => view.screenDistance(a, b)))
  return shapes
}

function isSamePoint(a: WorldPoint, b: WorldPoint): boolean {
  return Math.abs(a.x - b.x) < SAME_CORNER_M && Math.abs(a.y - b.y) < SAME_CORNER_M
}
