// canvas/runtime/tools/select/select-tool.ts
//
// Owns the Select tool (spec §1.4, §3.2): a plain CanvasTool the ToolHost runs, composed of today's Select gestures. A
// press selects at once (click.ts) and goes on as a band from empty ground (band.ts), a move-drag of the selection
// (move-drag.ts) or nothing more; a double-click opens a note for editing in the host's text entry (note-edit.ts), as do
// Enter and F2 on one selected note ('edit-text'). Its handles are the rotation handle (rotate-handle.ts), the selected
// zone's reshape points (reshape.ts) and the selected guide's ends (guide-ends.ts); the host shows them while Select is
// armed, the text entry is closed and no Scene Edit is open. Hovers pass, so the host's passive hover runs, and the tool
// card's gesture flag stays off, as today's Select published.

import type { ToolHandleId } from '../../interaction-types'
import type { SceneMeasurementGuideEntity, SceneZoneEntity } from '../../scene/types'
import type { ToolHandle } from '../draft'
import type { CanvasTool, HitTarget, ToolContext, ToolGesture, ToolPoint, ToolReply } from '../tool'
import { bandDraft, bandSelection, type Band } from './band'
import { pressSelection, type ClickCandidate } from './click'
import { draggableGuide, guideEndHandles, guideEnds, guideEndSubject, guideLengthShapes, type GuideEnd } from './guide-ends'
import { abortMoveDrag, beginMoveDrag, commitMoveDrag, hasMoved, moveSelection, type MoveDrag } from './move-drag'
import { noteExists, openNoteEntry, selectedEditableNoteId } from './note-edit'
import { beginPointHandleDrag, type PointHandleDrag } from './point-handle'
import { reshapableZone, zoneControlPointHandles, zoneControlPoints, zoneReshapeSubject, type ZoneControlPoint } from './reshape'
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

/** What the press started, from the press to its release or cancel. */
type SelectGesture =
  | { readonly kind: 'band'; readonly band: Band }
  | { readonly kind: 'move'; readonly drag: MoveDrag; readonly click: Omit<ClickCandidate, 'atMs'> }
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
  let reshapePoints = new Map<ToolHandleId, ZoneControlPoint>()
  let guideEndPoints = new Map<ToolHandleId, GuideEnd>()

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
    // A point handle's drag hides the rotation handle from its press to its release, as today's drag presentation did.
    const pointDrag = gesture?.kind === 'reshape' || gesture?.kind === 'guide-end'
    const rotate = pointDrag ? null : rotateHandle(selection, c.view, c.translate, rotationDeltaDeg)
    handlesBearingDeg = c.view.bearingDeg
    if (rotate) handles.push(rotate)
    const zone = reshapableZone(scene, selection)
    const points = zone ? zoneControlPoints(zone) : []
    reshapePoints = new Map(points.map((entry) => [entry.id, entry]))
    handles.push(...zoneControlPointHandles(points))
    const guide = draggableGuide(scene, selection)
    const ends = guide ? guideEnds(guide) : []
    guideEndPoints = new Map(ends.map((entry) => [entry.id, entry]))
    handles.push(...guideEndHandles(ends))
    c.effects.setHandles(handles)
  }

  /** A camera frame that turned the view moves the rotation handle; a pan or a zoom leaves it where it is. */
  function followBearing(): void {
    if (context && context.view.bearingDeg !== handlesBearingDeg) refreshHandles()
  }

  function press(point: ToolPoint, hit: HitTarget | null, clickCount: number): void {
    const c = ctx()
    const result = pressSelection(c, point, hit, clickCount, lastClick, c.now())
    switch (result.kind) {
      case 'band': {
        const band: Band = { start: point.world, additive: result.additive }
        gesture = { kind: 'band', band }
        c.effects.setDraft(bandDraft(c.view, band, point.world))
        break
      }
      case 'move':
        gesture = {
          kind: 'move',
          drag: beginMoveDrag(c, c.scene.persisted, result.target, point),
          click: { target: result.target, world: point.world },
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
      } else if (current.kind === 'move') {
        // Today's release reads the last move: the pointer's travel since then moves nothing.
        if (hasMoved(current.drag)) {
          commitMoveDrag(current.drag)
        } else {
          abortMoveDrag(current.drag)
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
      startHandleDrag(g.handle, g.start)
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
    } finally {
      if (!('drag' in current) || !current.drag.open) gesture = null
      rotationDeltaDeg = null
      c.effects.setDraft(null)
      refreshHandles()
    }
  }

  function startHandleDrag(handle: ToolHandleId, start: ToolPoint): void {
    const c = ctx()
    const scene = c.scene.persisted
    const selection = c.scene.selectionModel()
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

  /** Rolls back what the gesture changed; an abort that fails keeps the gesture, which the host's retry cancels again. */
  function cancelGesture(): void {
    const current = gesture
    if (!current) return
    try {
      if (current.kind === 'move') abortMoveDrag(current.drag)
      else if (current.kind === 'rotate') abortRotation(current.drag)
      else if (current.kind === 'reshape' || current.kind === 'guide-end') current.drag.cancel()
      gesture = null
    } finally {
      rotationDeltaDeg = null
      ctx().effects.setDraft(null)
      refreshHandles()
    }
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
      // Today's Select published no gesture to the tool card, whatever it held.
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
          // The press stays Select's to its release: no passive hover over its moves, as today.
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
          followBearing()
          break
        default:
          break
      }
      return 'pass'
    },
    viewChanged() {
      followBearing()
    },
    command(c): ToolReply {
      if (c.kind !== 'edit-text') return 'pass'
      const noteId = selectedEditableNoteId(ctx())
      return noteId && editNote(noteId) ? 'handled' : 'pass'
    },
    sceneChanged() {
      const c = ctx()
      // Today's note editor closed once its note was gone (a replaced document, an undo).
      if (editingNoteId !== null && !noteExists(c.scene.persisted, editingNoteId)) {
        editingNoteId = null
        c.effects.closeTextEntry()
      }
      refreshHandles()
    },
    hasTransient: () => false,
    escapeHint: () => (context && context.scene.selection().length > 0 ? 'clear-selection' : null),
    cancelTransient() {
      cancelGesture()
    },
    deactivate() {
      gesture = null
      lastClick = null
      editingNoteId = null
      rotationDeltaDeg = null
      reshapePoints = new Map()
      guideEndPoints = new Map()
    },
  }
}
