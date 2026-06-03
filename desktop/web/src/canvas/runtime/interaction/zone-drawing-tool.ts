import { computeSelectionRect } from '../../operations'
import type { CameraController } from '../camera'
import type { ScenePoint, SceneStore } from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import {
  createEllipticalZoneMeasurements,
  createEllipticalZoneMeasurementsFromRect,
  createPolygonalZoneDraftMeasurements,
  createPolygonalZoneMeasurements,
  createRectangularZoneMeasurements,
  createRectangularZoneMeasurementsFromRect,
} from '../zone-measurements'
import { showInteractionPreview } from './overlay-ui'
import { createPolygonDraftOverlay } from './polygon-draft-overlay'
import { createZoneMeasurementOverlay } from './zone-measurement-overlay'
import {
  appendEllipseZoneToDraft,
  appendPolygonZoneToDraft,
  appendRectangleZoneToDraft,
} from './tool-actions'

type BoxZoneMode = 'rectangle' | 'ellipse'

interface ActiveBoxZoneDraft {
  readonly mode: BoxZoneMode
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
}

export interface ZoneDrawingTool {
  readonly hasPolygonDraft: () => boolean
  readonly beginBox: (mode: BoxZoneMode, world: ScenePoint) => void
  readonly updateBox: (rawWorld: ScenePoint) => void
  readonly commitBox: (rawWorld: ScenePoint) => void
  readonly handlePolygonPointerDown: (world: ScenePoint) => void
  readonly updatePolygonPointerMove: (rawWorld: ScenePoint) => void
  readonly handlePolygonKeyDown: (event: KeyboardEvent) => boolean
  readonly cancelTransient: (options?: { preservePolygonDraft?: boolean }) => void
  readonly refreshViewportDependent: () => boolean
  readonly refreshSelectedZoneMeasurements: () => void
  readonly dispose: () => void
}

export function createZoneDrawingTool(context: ZoneDrawingToolContext): ZoneDrawingTool {
  const polygonDraftOverlay = createPolygonDraftOverlay(context.container)
  const zoneMeasurements = createZoneMeasurementOverlay(context.container)
  let activeBox: ActiveBoxZoneDraft | null = null
  let polygonDraftVertices: ScenePoint[] = []
  let polygonActiveWorld: ScenePoint | null = null

  function beginBox(mode: BoxZoneMode, world: ScenePoint): void {
    const snappedWorld = context.applySnapping(world)
    const snappedScreen = context.camera.worldToScreen(snappedWorld)
    activeBox = {
      mode,
      startWorld: snappedWorld,
      startScreen: snappedScreen,
    }
    showInteractionPreview(context.preview, mode, snappedScreen, snappedScreen)
  }

  function updateBox(rawWorld: ScenePoint): void {
    if (!activeBox) return
    const endWorld = context.applySnapping(rawWorld)
    showInteractionPreview(
      context.preview,
      activeBox.mode,
      activeBox.startScreen,
      context.camera.worldToScreen(endWorld),
    )
    if (activeBox.mode === 'rectangle') {
      updateDraftRectangleMeasurements(activeBox.startWorld, endWorld)
    } else {
      updateDraftEllipseMeasurements(activeBox.startWorld, endWorld)
    }
  }

  function commitBox(rawWorld: ScenePoint): void {
    if (!activeBox) return
    const box = activeBox
    activeBox = null
    const rect = computeSelectionRect(box.startWorld, context.applySnapping(rawWorld))
    if (rect.width < 0.5 || rect.height < 0.5) return

    context.sceneEdits.run(
      box.mode === 'rectangle' ? 'interaction-rectangle' : 'interaction-ellipse',
      (tx) => {
        let zoneName: string | null = null
        tx.mutate((draft) => {
          zoneName = box.mode === 'rectangle'
            ? appendRectangleZoneToDraft(draft, rect)
            : appendEllipseZoneToDraft(draft, rect)
        })
        if (zoneName) tx.setSelection([zoneName])
      },
    )
  }

  function handlePolygonPointerDown(world: ScenePoint): void {
    const point = context.applySnapping(world)
    activeBox = null
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
    polygonActiveWorld = point
    polygonDraftOverlay.update(polygonDraftVertices, polygonActiveWorld, context.camera)
    updateDraftPolygonMeasurements()
  }

  function updatePolygonPointerMove(rawWorld: ScenePoint): void {
    polygonActiveWorld = context.applySnapping(rawWorld)
    polygonDraftOverlay.update(polygonDraftVertices, polygonActiveWorld, context.camera)
    updateDraftPolygonMeasurements()
  }

  function handlePolygonKeyDown(event: KeyboardEvent): boolean {
    if (polygonDraftVertices.length === 0) return false
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelPolygonDraft()
      return true
    }
    if (event.key === 'Backspace') {
      event.preventDefault()
      removeLastPolygonVertex()
      return true
    }
    if (event.key === 'Enter') {
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

  function removeLastPolygonVertex(): void {
    polygonDraftVertices = polygonDraftVertices.slice(0, -1)
    if (polygonDraftVertices.length === 0) {
      cancelPolygonDraft()
      return
    }
    polygonDraftOverlay.update(polygonDraftVertices, polygonActiveWorld, context.camera)
    updateDraftPolygonMeasurements()
  }

  function cancelPolygonDraft(): void {
    const hadDraft = polygonDraftVertices.length > 0 || polygonActiveWorld !== null
    polygonDraftVertices = []
    polygonActiveWorld = null
    polygonDraftOverlay.hide()
    if (hadDraft) zoneMeasurements.hide()
  }

  function cancelTransient(options: { preservePolygonDraft?: boolean } = {}): void {
    activeBox = null
    if (!options.preservePolygonDraft) cancelPolygonDraft()
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
    if (scene.groups.some((group) => group.id === selectedId || group.memberIds.includes(selectedId))) {
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
        createEllipticalZoneMeasurements(zone.points[0]!, zone.points[1]!),
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
      createRectangularZoneMeasurements(zone.points),
      context.camera,
    )
  }

  function dispose(): void {
    polygonDraftOverlay.dispose()
    zoneMeasurements.dispose()
  }

  return {
    hasPolygonDraft: () => polygonDraftVertices.length > 0,
    beginBox,
    updateBox,
    commitBox,
    handlePolygonPointerDown,
    updatePolygonPointerMove,
    handlePolygonKeyDown,
    cancelTransient,
    refreshViewportDependent,
    refreshSelectedZoneMeasurements,
    dispose,
  }
}

function pointsEqual(a: ScenePoint, b: ScenePoint): boolean {
  return Math.abs(a.x - b.x) < 0.0001 && Math.abs(a.y - b.y) < 0.0001
}
