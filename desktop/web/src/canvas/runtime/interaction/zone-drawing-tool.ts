import { computeSelectionRect } from '../../operations'
import type { CameraController } from '../camera'
import type { ScenePoint, SceneStore } from '../scene'
import { isSceneObjectGroupMemberTarget } from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import {
  createEllipticalZoneMeasurements,
  createEllipticalZoneMeasurementsFromRect,
  createLinearZoneMeasurements,
  createPolygonalZoneDraftMeasurements,
  createPolygonalZoneMeasurements,
  createRectangularZoneMeasurements,
  createRectangularZoneMeasurementsFromRect,
} from '../zone-measurements'
import { showInteractionPreview } from './overlay-ui'
import { createPolygonDraftOverlay } from './polygon-draft-overlay'
import {
  createZoneMeasurementOverlay,
  type ZoneMeasurementOverlayController,
} from './zone-measurement-overlay'
import {
  appendEllipseZoneToDraft,
  appendLineZoneToDraft,
  appendPolygonZoneToDraft,
  appendRectangleZoneToDraft,
} from './tool-actions'
import { getRectangularZoneCorners } from '../zone-geometry'
import { isEditableTarget } from './pointer-utils'
import type { SceneToolAdapter } from './tool-adapter'
import { isSceneLayerOpenForCreation } from './layer-guards'

type DragZoneMode = 'line' | 'rectangle' | 'ellipse'

interface ActiveDragZoneDraft {
  readonly mode: DragZoneMode
  readonly startWorld: ScenePoint
  readonly startScreen: ScenePoint
}

export interface ZoneDrawingToolContext {
  readonly container: HTMLElement
  readonly preview: HTMLDivElement
  readonly camera: CameraController
  readonly getSceneStore: () => SceneStore
  readonly getSelection: () => ReadonlySet<string>
  readonly clearSelection: () => void
  readonly sceneEdits: SceneEditCoordinator
  readonly render: (kind: 'scene' | 'viewport') => void
  readonly applySnapping: (point: ScenePoint) => ScenePoint
  readonly notifyTransientHistoryChange: () => void
}

export interface ZoneDrawingTool {
  readonly hasPolygonDraft: () => boolean
  readonly beginDrag: (mode: DragZoneMode, world: ScenePoint) => void
  readonly updateDrag: (rawWorld: ScenePoint) => void
  readonly commitDrag: (rawWorld: ScenePoint) => void
  readonly handlePolygonPointerDown: (world: ScenePoint) => void
  readonly updatePolygonPointerMove: (rawWorld: ScenePoint) => void
  readonly handlePolygonKeyDown: (event: KeyboardEvent) => boolean
  readonly canUndoPolygonDraft: () => boolean
  readonly canRedoPolygonDraft: () => boolean
  readonly undoPolygonDraft: () => boolean
  readonly redoPolygonDraft: () => boolean
  readonly cancelTransient: (options?: { preservePolygonDraft?: boolean }) => void
  readonly refreshViewportDependent: () => boolean
  readonly refreshSelectedZoneMeasurements: () => void
  readonly dispose: () => void
}

export function createZoneDrawingTool(context: ZoneDrawingToolContext): ZoneDrawingTool {
  const polygonDraftOverlay = createPolygonDraftOverlay(context.container)
  let zoneMeasurements: ZoneMeasurementOverlayController
  try {
    zoneMeasurements = createZoneMeasurementOverlay(context.container)
  } catch (error) {
    polygonDraftOverlay.dispose()
    throw error
  }
  let activeDrag: ActiveDragZoneDraft | null = null
  let polygonDraftVertices: ScenePoint[] = []
  let polygonActiveWorld: ScenePoint | null = null
  let polygonRedoVertices: ScenePoint[] = []

  function beginDrag(mode: DragZoneMode, world: ScenePoint): void {
    if (!isZonesLayerOpen()) return
    const snappedWorld = context.applySnapping(world)
    const snappedScreen = context.camera.worldToScreen(snappedWorld)
    activeDrag = {
      mode,
      startWorld: snappedWorld,
      startScreen: snappedScreen,
    }
    showInteractionPreview(context.preview, mode, snappedScreen, snappedScreen)
  }

  function updateDrag(rawWorld: ScenePoint): void {
    if (!activeDrag) return
    const endWorld = context.applySnapping(rawWorld)
    showInteractionPreview(
      context.preview,
      activeDrag.mode,
      activeDrag.startScreen,
      context.camera.worldToScreen(endWorld),
    )
    if (activeDrag.mode === 'line') {
      updateDraftLineMeasurements(activeDrag.startWorld, endWorld)
    } else if (activeDrag.mode === 'rectangle') {
      updateDraftRectangleMeasurements(activeDrag.startWorld, endWorld)
    } else {
      updateDraftEllipseMeasurements(activeDrag.startWorld, endWorld)
    }
  }

  function commitDrag(rawWorld: ScenePoint): void {
    if (!activeDrag) return
    const drag = activeDrag
    activeDrag = null
    if (!isZonesLayerOpen()) return
    const endWorld = context.applySnapping(rawWorld)

    if (drag.mode === 'line') {
      context.sceneEdits.run('interaction-line', (tx) => {
        let zoneName: string | null = null
        tx.mutate((draft) => {
          zoneName = appendLineZoneToDraft(draft, drag.startWorld, endWorld)
        })
        if (zoneName) tx.setSelection([zoneName])
      })
      return
    }

    const rect = computeSelectionRect(drag.startWorld, endWorld)
    if (rect.width < 0.5 || rect.height < 0.5) return

    context.sceneEdits.run(
      drag.mode === 'rectangle' ? 'interaction-rectangle' : 'interaction-ellipse',
      (tx) => {
        let zoneName: string | null = null
        tx.mutate((draft) => {
          zoneName = drag.mode === 'rectangle'
            ? appendRectangleZoneToDraft(draft, rect)
            : appendEllipseZoneToDraft(draft, rect)
        })
        if (zoneName) tx.setSelection([zoneName])
      },
    )
  }

  function handlePolygonPointerDown(world: ScenePoint): void {
    if (!isZonesLayerOpen()) {
      cancelPolygonDraft()
      return
    }
    const point = context.applySnapping(world)
    activeDrag = null
    zoneMeasurements.hide()

    if (shouldClosePolygonAt(point)) {
      commitPolygonDraft()
      return
    }

    const last = polygonDraftVertices[polygonDraftVertices.length - 1]
    if (last && pointsEqual(last, point)) {
      polygonActiveWorld = point
      polygonDraftOverlay.update(polygonDraftVertices, polygonActiveWorld, context.camera)
      updateDraftPolygonMeasurements()
      return
    }

    if (polygonDraftVertices.length === 0 && context.getSelection().size > 0) {
      context.clearSelection()
      context.render('scene')
    }
    polygonDraftVertices = [...polygonDraftVertices, point]
    polygonRedoVertices = []
    polygonActiveWorld = point
    polygonDraftOverlay.update(polygonDraftVertices, polygonActiveWorld, context.camera)
    updateDraftPolygonMeasurements()
    context.notifyTransientHistoryChange()
  }

  function updatePolygonPointerMove(rawWorld: ScenePoint): void {
    polygonActiveWorld = context.applySnapping(rawWorld)
    polygonDraftOverlay.update(polygonDraftVertices, polygonActiveWorld, context.camera)
    updateDraftPolygonMeasurements()
  }

  function handlePolygonKeyDown(event: KeyboardEvent): boolean {
    const hasDraftVertices = polygonDraftVertices.length > 0
    const hasRedoVertices = polygonRedoVertices.length > 0
    if (!hasDraftVertices && !hasRedoVertices) return false
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelPolygonDraft()
      return true
    }
    if (event.key === 'Backspace' && hasDraftVertices) {
      event.preventDefault()
      undoPolygonDraft()
      return true
    }
    if (event.key === 'Enter' && hasDraftVertices) {
      event.preventDefault()
      commitPolygonDraft()
      return true
    }
    return false
  }

  function shouldClosePolygonAt(point: ScenePoint): boolean {
    if (polygonDraftVertices.length < 3) return false
    const first = polygonDraftVertices[0]!
    const firstScreen = context.camera.worldToScreen(first)
    const pointScreen = context.camera.worldToScreen(point)
    return Math.hypot(pointScreen.x - firstScreen.x, pointScreen.y - firstScreen.y) <= 8
  }

  function commitPolygonDraft(): void {
    if (polygonDraftVertices.length < 3) return
    if (!isZonesLayerOpen()) {
      cancelPolygonDraft()
      return
    }
    const committed = context.sceneEdits.run('interaction-polygon', (tx) => {
      let zoneName: string | null = null
      tx.mutate((draft) => {
        zoneName = appendPolygonZoneToDraft(draft, polygonDraftVertices)
      })
      if (zoneName) tx.setSelection([zoneName])
    })
    if (committed) {
      cancelPolygonDraft()
      refreshSelectedZoneMeasurements()
    }
  }

  function canUndoPolygonDraft(): boolean {
    return polygonDraftVertices.length > 0
  }

  function canRedoPolygonDraft(): boolean {
    return polygonRedoVertices.length > 0
  }

  function undoPolygonDraft(): boolean {
    const removed = polygonDraftVertices[polygonDraftVertices.length - 1]
    if (!removed) return false
    polygonRedoVertices = [...polygonRedoVertices, removed]
    polygonDraftVertices = polygonDraftVertices.slice(0, -1)
    if (polygonDraftVertices.length === 0) {
      polygonActiveWorld = null
      polygonDraftOverlay.hide()
      zoneMeasurements.hide()
      context.notifyTransientHistoryChange()
      return true
    }
    polygonDraftOverlay.update(polygonDraftVertices, polygonActiveWorld, context.camera)
    updateDraftPolygonMeasurements()
    context.notifyTransientHistoryChange()
    return true
  }

  function redoPolygonDraft(): boolean {
    const restored = polygonRedoVertices[polygonRedoVertices.length - 1]
    if (!restored) return false
    polygonRedoVertices = polygonRedoVertices.slice(0, -1)
    polygonDraftVertices = [...polygonDraftVertices, restored]
    if (polygonActiveWorld === null) polygonActiveWorld = restored
    polygonDraftOverlay.update(polygonDraftVertices, polygonActiveWorld, context.camera)
    updateDraftPolygonMeasurements()
    context.notifyTransientHistoryChange()
    return true
  }

  function cancelPolygonDraft(): void {
    const hadDraft = polygonDraftVertices.length > 0 || polygonActiveWorld !== null
    const hadTransientHistory = hadDraft || polygonRedoVertices.length > 0
    polygonDraftVertices = []
    polygonActiveWorld = null
    polygonRedoVertices = []
    polygonDraftOverlay.hide()
    if (hadDraft) zoneMeasurements.hide()
    if (hadTransientHistory) context.notifyTransientHistoryChange()
  }

  function cancelTransient(options: { preservePolygonDraft?: boolean } = {}): void {
    activeDrag = null
    if (!options.preservePolygonDraft) cancelPolygonDraft()
  }

  function updateDraftLineMeasurements(startWorld: ScenePoint, endWorld: ScenePoint): void {
    zoneMeasurements.update(
      createLinearZoneMeasurements(startWorld, endWorld),
      context.camera,
    )
  }

  function updateDraftRectangleMeasurements(startWorld: ScenePoint, endWorld: ScenePoint): void {
    zoneMeasurements.update(
      createRectangularZoneMeasurementsFromRect(computeSelectionRect(startWorld, endWorld)),
      context.camera,
    )
  }

  function updateDraftEllipseMeasurements(startWorld: ScenePoint, endWorld: ScenePoint): void {
    zoneMeasurements.update(
      createEllipticalZoneMeasurementsFromRect(computeSelectionRect(startWorld, endWorld)),
      context.camera,
    )
  }

  function updateDraftPolygonMeasurements(): void {
    zoneMeasurements.update(
      createPolygonalZoneDraftMeasurements(polygonDraftVertices, polygonActiveWorld),
      context.camera,
    )
  }

  function refreshViewportDependent(): boolean {
    if (polygonDraftVertices.length === 0) return false
    polygonDraftOverlay.update(polygonDraftVertices, polygonActiveWorld, context.camera)
    updateDraftPolygonMeasurements()
    return true
  }

  function refreshSelectedZoneMeasurements(): void {
    const selection = Array.from(context.getSelection())
    if (selection.length !== 1) {
      zoneMeasurements.hide()
      return
    }

    const selectedId = selection[0]!
    const scene = context.getSceneStore().persisted
    const zonesLayer = scene.layers.find((entry) => entry.name === 'zones')
    if (zonesLayer?.visible === false) {
      zoneMeasurements.hide()
      return
    }
    if (scene.groups.some((group) =>
      group.id === selectedId
      || group.members.some((member) =>
        isSceneObjectGroupMemberTarget(member, { kind: 'zone', id: selectedId }),
      ),
    )) {
      zoneMeasurements.hide()
      return
    }

    const zone = scene.zones.find((entry) => entry.name === selectedId)
    if (!zone) {
      zoneMeasurements.hide()
      return
    }

    if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
      zoneMeasurements.update(
        createEllipticalZoneMeasurements(zone.points[0]!, zone.points[1]!, zone.rotationDeg),
        context.camera,
      )
      return
    }

    if (zone.zoneType === 'line' && zone.points.length >= 2) {
      zoneMeasurements.update(
        createLinearZoneMeasurements(zone.points[0]!, zone.points[1]!),
        context.camera,
      )
      return
    }

    if (zone.zoneType === 'polygon') {
      zoneMeasurements.update(
        createPolygonalZoneMeasurements(zone.points),
        context.camera,
      )
      return
    }

    if (zone.zoneType !== 'rect') {
      zoneMeasurements.hide()
      return
    }

    zoneMeasurements.update(
      createRectangularZoneMeasurements(getRectangularZoneCorners(zone) ?? zone.points),
      context.camera,
    )
  }

  function dispose(): void {
    polygonDraftOverlay.dispose()
    zoneMeasurements.dispose()
  }

  function isZonesLayerOpen(): boolean {
    return isSceneLayerOpenForCreation(context.getSceneStore().persisted, 'zones')
  }

  return {
    hasPolygonDraft: () => polygonDraftVertices.length > 0,
    beginDrag,
    updateDrag,
    commitDrag,
    handlePolygonPointerDown,
    updatePolygonPointerMove,
    handlePolygonKeyDown,
    canUndoPolygonDraft,
    canRedoPolygonDraft,
    undoPolygonDraft,
    redoPolygonDraft,
    cancelTransient,
    refreshViewportDependent,
    refreshSelectedZoneMeasurements,
    dispose,
  }
}

export interface ZoneDrawingToolAdapters {
  readonly line: SceneToolAdapter
  readonly rectangle: SceneToolAdapter
  readonly ellipse: SceneToolAdapter
  readonly polygon: SceneToolAdapter
}

export function createZoneDrawingToolAdapters(tool: ZoneDrawingTool): ZoneDrawingToolAdapters {
  function cancelTransient(options: { preserveActiveDraft?: boolean } = {}): void {
    tool.cancelTransient({ preservePolygonDraft: options.preserveActiveDraft })
  }

  function createDragAdapter(mode: DragZoneMode): SceneToolAdapter {
    return {
      onDeactivate: () => tool.cancelTransient(),
      pointerDown({ event, rawWorld, beginDrag }) {
        event.preventDefault()
        tool.beginDrag(mode, rawWorld)
        beginDrag({
          update: ({ rawWorld }) => tool.updateDrag(rawWorld),
          commit: ({ rawWorld }) => tool.commitDrag(rawWorld),
        })
        return true
      },
      cancelTransient,
    }
  }

  return {
    line: createDragAdapter('line'),
    rectangle: createDragAdapter('rectangle'),
    ellipse: createDragAdapter('ellipse'),
    polygon: {
      onDeactivate: () => tool.cancelTransient(),
      shouldIgnorePointerUpWithoutCapture: tool.hasPolygonDraft,
      shouldPreserveTransientOnPan: tool.hasPolygonDraft,
      pointerDown({ event, rawWorld, clearPointerGesture }) {
        event.preventDefault()
        clearPointerGesture()
        tool.handlePolygonPointerDown(rawWorld)
        return true
      },
      pointerMoveWithoutCapture({ rawWorld }) {
        if (!tool.hasPolygonDraft()) return false
        tool.updatePolygonPointerMove(rawWorld)
        return true
      },
      keyDown(event) {
        if (isEditableTarget(event.target)) return false
        return tool.handlePolygonKeyDown(event)
      },
      canUndoTransientHistory: tool.canUndoPolygonDraft,
      canRedoTransientHistory: tool.canRedoPolygonDraft,
      undoTransientHistory: tool.undoPolygonDraft,
      redoTransientHistory: tool.redoPolygonDraft,
      cancelTransient,
      refreshViewportDependent: tool.refreshViewportDependent,
      refreshSelectionDependent: tool.refreshSelectedZoneMeasurements,
      dispose: tool.dispose,
    },
  }
}

function pointsEqual(a: ScenePoint, b: ScenePoint): boolean {
  return Math.abs(a.x - b.x) < 0.0001 && Math.abs(a.y - b.y) < 0.0001
}
