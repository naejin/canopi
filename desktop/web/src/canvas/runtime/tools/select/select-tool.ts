// canvas/runtime/tools/select/select-tool.ts
//
// Owns the Select tool (spec §1.4, §3.2): a plain CanvasTool the ToolHost runs, composed of the Select gestures. A
// press selects at once (click.ts) and goes on as a band from empty ground (band.ts), a move-drag of the selection
// (move-drag.ts) or nothing more; a double-click opens a note for editing in the host's text entry (note-edit.ts), as do
// Enter and F2 on one selected note ('edit-text'). Its handles are the rotation handle (rotate-handle.ts), the selected
// zone's reshape points (reshape.ts) and the selected guide's ends (guide-ends.ts); the host shows them while Select is
// armed, the text entry is closed and no Scene Edit is open. Hovers pass, so the host's passive hover runs, and the tool
// card's gesture flag stays off.

import type { ToolHandleId } from '../../interaction-types'
import type { SceneMeasurementGuideEntity, SceneZoneEntity } from '../../scene/types'
import type { ToolHandle } from '../draft'
import type { CanvasTool, HitTarget, ToolContext, ToolGesture, ToolPoint, ToolReply } from '../tool'
import { bandDraft, bandSelection, type Band } from './band'
import { clickSelection, pressSelection, type ClickCandidate, type SelectPress } from './click'
import { draggableGuide, guideEndHandles, guideEnds, guideEndSubject, guideLengthShapes, type GuideEnd } from './guide-ends'
import { abortMoveDrag, beginMoveDrag, commitMoveDrag, hasMoved, moveSelection, type MoveDrag } from './move-drag'
import { noteExists, openNoteEntry, selectedEditableNoteId } from './note-edit'
import { beginPointHandleDrag, type PointHandleDrag } from './point-handle'
import {
  addPolygonCorner,
  isPolygonCorner,
  removePolygonCorner,
  reshapableZone,
  zoneControlPointHandles,
  zoneControlPoints,
  zoneEdgeMidpointHandles,
  zoneEdgeMidpoints,
  zoneReshapeSubject,
  type ZoneControlPoint,
  type ZoneEdgeMidpoint,
} from './reshape'
import {
  abortRotation,
  applyRotation,
  beginRotation,
  finishRotation,
  ROTATE_HANDLE_ID,
  rotateHandle,
  rotationConstraint,
  type RotationDrag,
} from './rotate-handle'

/** A double-click this close to the selected polygon's edge adds a corner there: the outline's own hit tolerance. */
const EDGE_DOUBLE_CLICK_PX = 6
/** A corner released within this many pixels of its press was pressed without moving (the point drag's threshold). */
const STILL_CORNER_PX = 2

/** What the press started, from the press to its release or cancel. */
type SelectGesture =
  | { readonly kind: 'band'; readonly band: Band; readonly press: SelectPress }
  | { readonly kind: 'move'; readonly drag: MoveDrag; readonly click: Omit<ClickCandidate, 'atMs'>; readonly press: SelectPress }
  | { readonly kind: 'rotate'; readonly drag: RotationDrag }
  | { readonly kind: 'reshape'; readonly drag: PointHandleDrag<SceneZoneEntity> }
  | { readonly kind: 'guide-end'; readonly drag: PointHandleDrag<SceneMeasurementGuideEntity> }
  /** A press that selected and ends with its release (a locked hit, an additive toggle, a species, a note opened). */
  | { readonly kind: 'done' }

export function createSelectTool(): CanvasTool {
  let context: ToolContext | null = null
  let gesture: SelectGesture | null = null
  let lastClick: ClickCandidate | null = null
  let editingNoteId: string | null = null
  /** The turn so far while the rotation handle is dragged: its readout, shown while the host shows the handles. */
  let rotationDeltaDeg: number | null = null
  /** The bearing the handles were placed at: the rotation handle sits above the projected hull, so a turn moves it. */
  let handlesBearingDeg = 0
  /** The reshaped zone the handles were drawn for: a zoom changes which of its edges have room for a midpoint dot. */
  let handlesZone: SceneZoneEntity | null = null
  let reshapePoints = new Map<ToolHandleId, ZoneControlPoint>()
  let edgeMidpoints = new Map<ToolHandleId, ZoneEdgeMidpoint>()
  let guideEndPoints = new Map<ToolHandleId, GuideEnd>()
  /** The selected corner: the polygon corner last pressed without moving, shown as the active handle; Delete removes it. */
  let selectedCorner: ToolHandleId | null = null

  function ctx(): ToolContext {
    if (!context) throw new Error('The Select tool is not active.')
    return context
  }

  /** The rotation handle, the selected zone's reshape points and the selected guide's ends, for the current selection. */
  function refreshHandles(): void {
    const c = ctx()
    const scene = c.scene.persisted
    const selection = c.scene.selectionModel()
    const handles: ToolHandle[] = []
    // A point handle's drag hides the rotation handle from its press to its release.
    const pointDrag = gesture?.kind === 'reshape' || gesture?.kind === 'guide-end'
    const rotate = pointDrag ? null : rotateHandle(c.scene, selection, c.view, c.translate, rotationDeltaDeg)
    handlesBearingDeg = c.view.bearingDeg
    if (rotate) handles.push(rotate)
    const zone = reshapableZone(scene, selection)
    handlesZone = zone
    const points = zone ? zoneControlPoints(zone) : []
    reshapePoints = new Map(points.map((entry) => [entry.id, entry]))
    handles.push(...zoneControlPointHandles(points, c.translate))
    const midpoints = zone ? zoneEdgeMidpoints(zone, c.view) : []
    edgeMidpoints = new Map(midpoints.map((entry) => [entry.id, entry]))
    handles.push(...zoneEdgeMidpointHandles(midpoints, c.translate))
    const guide = draggableGuide(scene, selection)
    const ends = guide ? guideEnds(guide) : []
    guideEndPoints = new Map(ends.map((entry) => [entry.id, entry]))
    handles.push(...guideEndHandles(ends, c.translate))
    if (selectedCorner && !reshapePoints.has(selectedCorner)) selectedCorner = null
    c.effects.setHandles(handles, selectedCorner)
  }

  /** A camera frame that turned the view, or zoomed it so another set of edges has room for a dot, redraws the handles;
   *  a pan leaves them as they are. The host re-emits a hover or a live drag on each camera frame, so both follow it. */
  function followView(): void {
    if (!context) return
    const { view } = context
    const dots = handlesZone ? zoneEdgeMidpoints(handlesZone, view) : []
    const dotsChanged = dots.length !== edgeMidpoints.size || dots.some((dot) => !edgeMidpoints.has(dot.id))
    if (view.bearingDeg !== handlesBearingDeg || dotsChanged) refreshHandles()
  }

  function press(point: ToolPoint, hit: HitTarget | null, clickCount: number): void {
    const c = ctx()
    selectedCorner = null
    if (clickCount >= 2 && addCornerOnEdge(point)) {
      lastClick = null
      gesture = { kind: 'done' }
      refreshHandles()
      return
    }
    const result = pressSelection(c, point, hit, clickCount, lastClick, c.now())
    switch (result.kind) {
      case 'band': {
        const band: Band = { start: point.world, additive: result.additive }
        gesture = { kind: 'band', band, press: result }
        c.effects.setDraft(bandDraft(c.view, band, point.world))
        break
      }
      case 'move':
        gesture = {
          kind: 'move',
          drag: beginMoveDrag(c, c.scene.persisted, result.target, point),
          click: { target: result.target, world: point.world },
          press: result,
        }
        break
      case 'edit-note':
        lastClick = null
        gesture = { kind: 'done' }
        editNote(result.annotationId)
        break
      case 'done':
        gesture = { kind: 'done' }
        break
    }
    refreshHandles()
  }

  /** A double-click on an edge of the selected polygon adds a corner there (reusing hitZoneEdge's edge). */
  function addCornerOnEdge(point: ToolPoint): boolean {
    const c = ctx()
    if (point.modifiers.additive || point.modifiers.subtractive) return false
    const edge = c.scene.hitAt(point.world, { toleranceScreenPx: EDGE_DOUBLE_CLICK_PX })
    const zone = reshapableZone(c.scene.persisted, c.scene.selectionModel())
    if (edge?.kind !== 'zone-edge' || zone?.zoneType !== 'polygon' || edge.zoneId !== zone.id) return false
    addPolygonCorner(c, zone.id, edge.edgeIndex, point.world)
    return true
  }

  function dragTo(point: ToolPoint): void {
    const c = ctx()
    const current = gesture
    if (current?.kind === 'band') {
      c.effects.setDraft(bandDraft(c.view, current.band, point.world))
    } else if (current?.kind === 'move') {
      const draft = moveSelection(c, current.drag, point)
      if (draft !== undefined) c.effects.setDraft(draft)
    }
  }

  /** The press's release, after a drag (`dragged`) or without one. */
  function release(point: ToolPoint, dragged: boolean): void {
    const c = ctx()
    const current = gesture
    if (!current) return
    let clickCandidate: ClickCandidate | null = null
    try {
      if (current.kind === 'band') {
        const selection = dragged ? bandSelection(c, current.band, point.world) : null
        if (selection) c.effects.setSelection(selection)
        else if (!dragged) clickSelection(c, current.press)
      } else if (current.kind === 'move') {
        // The release reads the last move: the pointer's travel since then moves nothing.
        if (hasMoved(current.drag)) {
          commitMoveDrag(current.drag)
        } else {
          abortMoveDrag(current.drag)
          clickSelection(c, current.press)
          clickCandidate = { ...current.click, atMs: c.now() }
        }
      }
    } finally {
      if (!('drag' in current) || !current.drag.open) gesture = null
      lastClick = clickCandidate
      c.effects.setDraft(null)
      refreshHandles()
    }
  }

  function handleDrag(g: Extract<ToolGesture, { kind: 'handle-drag' }>): void {
    const c = ctx()
    if (g.phase === 'start') {
      startHandleDrag(g)
      refreshHandles()
      return
    }
    const current = gesture
    if (!current) return
    if (g.phase === 'move') {
      if (current.kind === 'rotate') rotationDeltaDeg = applyRotation(current.drag, g.point)
      else if (current.kind === 'reshape') current.drag.move(g.point)
      else if (current.kind === 'guide-end') {
        current.drag.move(g.point)
        const guide = current.drag.current
        const shapes = guide ? guideLengthShapes(guide, (a, b) => c.view.screenDistance(a, b)) : []
        c.effects.setDraft(shapes.length > 0 ? { shapes } : null)
      }
      return
    }
    try {
      if (current.kind === 'rotate') finishRotation(current.drag, g.point)
      else if (current.kind === 'reshape' || current.kind === 'guide-end') current.drag.finish(g.point)
      // A polygon corner released where it was pressed becomes the selected corner.
      const still = c.view.screenDistance(g.start.world, g.point.world) <= STILL_CORNER_PX
      const corner = current.kind === 'reshape' ? reshapePoints.get(g.handle) : undefined
      selectedCorner = still && corner && isPolygonCorner(corner) ? g.handle : null
    } finally {
      if (!('drag' in current) || !current.drag.open) gesture = null
      rotationDeltaDeg = null
      c.effects.setDraft(null)
      refreshHandles()
    }
  }

  function startHandleDrag(g: Extract<ToolGesture, { kind: 'handle-drag' }>): void {
    const { handle, start } = g
    const c = ctx()
    const scene = c.scene.persisted
    const selection = c.scene.selectionModel()
    // A double-click on an edge's midpoint dot adds a corner there; its single click and its drag do nothing.
    const edgeMidpoint = edgeMidpoints.get(handle)
    if (edgeMidpoint) {
      if (g.clickCount >= 2) addPolygonCorner(c, edgeMidpoint.zoneId, edgeMidpoint.edgeIndex, edgeMidpoint.world)
      gesture = { kind: 'done' }
      return
    }
    // Alt+click on a polygon corner removes it, keeping at least 3.
    const pressedCorner = reshapePoints.get(handle)
    if (pressedCorner && isPolygonCorner(pressedCorner) && start.modifiers.subtractive) {
      removePolygonCorner(c, pressedCorner.zoneId, pressedCorner.index)
      gesture = { kind: 'done' }
      return
    }
    if (handle === ROTATE_HANDLE_ID) {
      const drag = beginRotation(c, scene, start)
      if (!drag) return
      gesture = { kind: 'rotate', drag }
      rotationDeltaDeg = 0
      return
    }
    const reshapePoint = reshapePoints.get(handle)
    const zone = reshapePoint ? reshapableZone(scene, selection) : null
    if (reshapePoint && zone?.id === reshapePoint.zoneId) {
      gesture = { kind: 'reshape', drag: beginPointHandleDrag(c, zoneReshapeSubject(zone, reshapePoint), start) }
      return
    }
    const end = guideEndPoints.get(handle)
    const guide = end ? draggableGuide(scene, selection) : null
    if (end && guide?.id === end.guideId) {
      gesture = { kind: 'guide-end', drag: beginPointHandleDrag(c, guideEndSubject(guide, end), start) }
    }
  }

  /** Rolls back what the gesture changed. */
  function cancelGesture(): void {
    const current = gesture
    if (!current) return
    if (current.kind === 'move') abortMoveDrag(current.drag)
    else if (current.kind === 'rotate') abortRotation(current.drag)
    else if (current.kind === 'reshape' || current.kind === 'guide-end') current.drag.cancel()
    gesture = null
    rotationDeltaDeg = null
    ctx().effects.setDraft(null)
    refreshHandles()
  }

  /** Delete on the focused corner, else the selected one: removed, keeping at least 3; with neither, Delete passes. */
  function deleteCorner(): ToolReply {
    const focused = ctx().focusedHandle()
    const id = focused && reshapePoints.has(focused) ? focused : selectedCorner
    const corner = id ? reshapePoints.get(id) : undefined
    if (!corner || !isPolygonCorner(corner)) return 'pass'
    selectedCorner = null
    removePolygonCorner(ctx(), corner.zoneId, corner.index)
    refreshHandles()
    return 'handled'
  }

  function editNote(annotationId: string): boolean {
    const opened = openNoteEntry(ctx(), annotationId, () => {
      if (editingNoteId === annotationId) editingNoteId = null
    })
    if (opened) editingNoteId = annotationId
    return opened
  }

  return {
    id: 'select',
    settledRelease: () => gesture?.kind === 'band',
    constraint: () => (gesture?.kind === 'rotate' ? rotationConstraint(gesture.drag) : null),
    activate(ctx) {
      context = ctx
      // Select publishes no gesture to the tool card, whatever it holds.
      ctx.effects.setGuidance({ gesture: false })
      refreshHandles()
    },
    gesture(g): ToolReply {
      switch (g.kind) {
        case 'press':
          press(g.point, g.hit, g.clickCount)
          break
        case 'drag-start':
        case 'drag-move':
          dragTo(g.point)
          // The host re-emits a live drag on a camera frame, not a hover: a key turn mid-band moves the handle too.
          followView()
          // The press stays Select's to its release: no passive hover over its moves.
          return 'handled'
        case 'drag-end':
          release(g.point, true)
          break
        case 'tap':
          release(g.point, false)
          break
        case 'handle-drag':
          handleDrag(g)
          break
        case 'cancel':
          cancelGesture()
          break
        case 'hover':
          // The host re-emits the resting pointer on a camera frame instead of calling viewChanged.
          followView()
          break
        default:
          break
      }
      return 'pass'
    },
    viewChanged() {
      followView()
    },
    command(c): ToolReply {
      if (c.kind === 'delete-handle') return deleteCorner()
      if (c.kind !== 'edit-text') return 'pass'
      const noteId = selectedEditableNoteId(ctx())
      return noteId && editNote(noteId) ? 'handled' : 'pass'
    },
    sceneChanged() {
      const c = ctx()
      // The note editor closes once its note is gone (a replaced document, an undo).
      if (editingNoteId !== null && !noteExists(c.scene.persisted, editingNoteId)) {
        editingNoteId = null
        c.effects.closeTextEntry()
      }
      refreshHandles()
    },
    hasTransient: () => false,
    cancelTransient() {
      cancelGesture()
    },
    deactivate() {
      gesture = null
      lastClick = null
      editingNoteId = null
      rotationDeltaDeg = null
      reshapePoints = new Map()
      edgeMidpoints = new Map()
      guideEndPoints = new Map()
      selectedCorner = null
    },
  }
}
