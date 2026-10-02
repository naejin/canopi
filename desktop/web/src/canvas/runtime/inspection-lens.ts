import { computed, effect, signal } from '@preact/signals'
import type { CanvasInspectionHandle, CanvasInspectionState, InspectionPoint } from '../inspection'
import type { CanvasQueryRevision } from './runtime'
import type { SceneRendererSnapshot } from './renderers/scene-types'
import type { SceneDesignObjectTarget } from './scene'
import { createSessionPlane, type SessionPlane } from '../session-plane'
import { stageScaleToMapZoom } from '../projection'
import { drawInspectionLensScene } from './inspection-lens-drawing'
import { getSceneLayerStyle } from './scene-visuals'
import { inspectionLayout } from './inspection-layout'
import { runCanvasRuntimeCleanups } from './cleanup'
import { buildViewTransform } from './view/view-transform'
import type { ViewFrameSource, WorldQuad } from './view/types'

/** 100 % lens zoom: 20 px per metre, the main map's zoom reference. */
const LENS_ZOOM_REFERENCE_PIXELS_PER_METRE = 20

interface InspectionOwnerOptions {
  /** The main map's frames: each one repaints the lens, places what it samples and moves its source outline. */
  readonly frames: Pick<ViewFrameSource, 'viewFrame'>
  readonly revision: CanvasQueryRevision
  /** The live session plane; the inspected point follows it across a re-origin. */
  readSessionPlane?(): SessionPlane | null
  getSnapshot(): SceneRendererSnapshot
  setHoveredTarget(target: SceneDesignObjectTarget | null): void
}

export class SceneCanvasInspectionOwner {
  private readonly views = new Set<{ reset(): void; refresh(): void; dispose(): void }>()
  private disposed = false
  constructor(private readonly options: InspectionOwnerOptions) {}
  mount(container: HTMLElement): CanvasInspectionHandle {
    if (this.disposed) throw new Error('Cannot attach an inspection view to a disposed Canvas.')
    const state = signal<CanvasInspectionState | null>(null)
    const canvas = document.createElement('canvas')
    canvas.style.width = '100%'; canvas.style.height = '100%'
    canvas.setAttribute('aria-hidden', 'true')
    let ctx: CanvasRenderingContext2D | null = null
    try { ctx = canvas.getContext('2d') } catch (error) { console.error('Canvas inspection preview unavailable:', error) }
    container.appendChild(canvas)
    // The inspected point in session-plane metres, and the plane it belongs to.
    let point: InspectionPoint | null = null
    let pointPlane: SessionPlane | null = null
    // The ground the lens shows, in plane metres; the main frame projects it, so the outline moves with the map.
    const footprint = signal<WorldQuad | null>(null)
    const sourceQuad = computed(() => {
      const quad = footprint.value
      return quad && options.frames.viewFrame.value.view.worldQuadToScreen(quad)
    })
    let magnification = 1
    let highlightedId: string | null = null
    let frame: number | null = null
    let lensViewRevision = 0
    let released = false
    const options = this.options

    /** The ground under a point of the main screen, through the live frame; null above a horizon. */
    function groundAt(screenPoint: InspectionPoint): InspectionPoint | null {
      return options.frames.viewFrame.peek().view.screenToWorld(screenPoint)
    }
    function canvasCenter(): InspectionPoint {
      const { screen } = options.frames.viewFrame.peek().view
      // The screen centre is the camera's own ground point, never above a horizon.
      return groundAt({ x: screen.width / 2, y: screen.height / 2 })!
    }
    function setPoint(next: InspectionPoint | null) {
      point = next
      pointPlane = options.readSessionPlane?.() ?? null
    }
    /** The inspected point in the current plane: a re-origin keeps the same ground. */
    function livePoint(): InspectionPoint | null {
      const plane = options.readSessionPlane?.() ?? null
      if (point && pointPlane && plane && plane !== pointPlane) {
        point = plane.toPlane(pointPlane.toGeo(point))
      }
      pointPlane = plane
      return point
    }
    function schedule() {
      if (!released && frame === null) frame = requestAnimationFrame(paint)
    }
    function paint() {
      frame = null
      if (released) return
      const snapshot = options.getSnapshot()
      const centre = livePoint() ?? canvasCenter()
      setPoint(centre)
      const layer = getSceneLayerStyle(snapshot.scene, 'plants')
      const visible = layer.visible && layer.opacity > 0 ? snapshot.scene.plants : []
      const width = Math.max(1, container.clientWidth || 430), height = Math.max(1, container.clientHeight || 390)
      if (ctx) ctx.font = `600 12px ${getComputedStyle(container).fontFamily || 'sans-serif'}`
      const layout = inspectionLayout(visible, centre, { width, height }, snapshot.localizedCommonNames,
        value => ctx ? ctx.measureText(value).width : Array.from(value).length * 12, magnification)
      const { scale } = layout
      if (highlightedId && !layout.plants.some(plant => plant.id === highlightedId)) clearHighlight()
      const dpr = Math.max(window.devicePixelRatio || 1, 1)
      // The lens's own view: the inspected point at its centre, at bearing 0 (spec §4.13).
      const plane = options.readSessionPlane?.() ?? createSessionPlane({ lon: 0, lat: 0 })
      const lensView = buildViewTransform({
        camera: { center: plane.toGeo(centre), zoom: stageScaleToMapZoom(scale, plane.origin.lat), bearingDeg: 0, pitchDeg: 0 },
        screen: { width, height, devicePixelRatio: dpr },
        plane,
        planeRevision: options.frames.viewFrame.peek().view.planeRevision,
        revision: ++lensViewRevision,
      })
      footprint.value = lensView.visibleWorldQuad()
      if (ctx) {
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr)
        const plants = visible.filter((plant) => Math.abs(plant.position.x - centre.x) * scale <= width / 2 + 20
          && Math.abs(plant.position.y - centre.y) * scale <= height / 2 + 20)
        const lensSnapshot: SceneRendererSnapshot = {
          ...snapshot,
          scene: { ...snapshot.scene, plants, annotations: [], measurementGuides: [], groups: [] },
          selectedPlantIds: new Set(), selectedZoneIds: new Set(), selectedAnnotationIds: new Set(), selectedMeasurementGuideIds: new Set(),
          highlightedPlantIds: new Set(), highlightedZoneIds: new Set(), hoveredCanonicalName: null,
          hoverTarget: highlightedId ? { kind: 'plant', id: highlightedId, state: 'hover' } : null,
          speciesFocus: { canonicalName: null },
          revealedAnnotationId: null, selectionLabelPlantIds: new Set(),
        }
        try {
          drawInspectionLensScene(ctx, lensSnapshot, lensView, { widthPx: width, heightPx: height, dpr })
        } catch (error) {
          console.error('Canvas inspection preview unavailable:', error)
          ctx = null
        }
      }
      state.value = {
        point: centre, scale, zoomPercent: Math.round(scale / LENS_ZOOM_REFERENCE_PIXELS_PER_METRE * 100), previewAvailable: ctx !== null,
        frame: { width, height }, plants: layout.plants,
      }
    }
    function clearHighlight() {
      const previous = highlightedId
      highlightedId = null
      if (!previous) return
      const target = options.getSnapshot().hoverTarget
      if (target?.kind === 'plant' && target.id === previous) options.setHoveredTarget(null)
    }
    let unsubscribe: (() => void) | undefined
    let observer: ResizeObserver | null = null
    const owned = {
      refresh: schedule,
      reset: () => { if (!released) { setPoint(null); magnification = 1; clearHighlight(); schedule() } },
      dispose: () => {
        if (released) return
        released = true
        this.views.delete(owned)
        runCanvasRuntimeCleanups([
          () => { if (frame !== null) cancelAnimationFrame(frame); frame = null },
          () => unsubscribe?.(),
          () => observer?.disconnect(),
          () => document.fonts?.removeEventListener('loadingdone', schedule),
          () => canvas.remove(),
          () => { state.value = null; footprint.value = null },
          clearHighlight,
        ], 'Unable to release the inspection lens.')
      },
    }
    try {
      unsubscribe = effect(() => {
        void options.revision.scene.value
        void options.revision.plantNames.value
        void options.frames.viewFrame.value
        schedule()
      })
      document.fonts?.addEventListener('loadingdone', schedule)
      observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
      observer?.observe(container)
    } catch (error) {
      owned.dispose()
      throw error
    }
    this.views.add(owned)
    /** A plane point, as the ToolHost publishes the pointer (subscribePointerWorld): no screen conversion here. */
    function inspectAtWorldPoint(world: InspectionPoint): void {
      if (released || !Number.isFinite(world.x) || !Number.isFinite(world.y)) return
      if (point?.x === world.x && point.y === world.y) return
      setPoint({ x: world.x, y: world.y })
      schedule()
    }
    return {
      state,
      sourceQuad,
      inspectAtScreenPoint: (screenPoint) => {
        if (released || !Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) return
        const next = groundAt(screenPoint)
        if (next) inspectAtWorldPoint(next)
      },
      inspectAtWorldPoint,
      centerOnCanvas: () => { if (!released) { setPoint(canvasCenter()); schedule() } },
      panBy: (delta) => {
        if (released || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return
        const centre = livePoint() ?? canvasCenter()
        setPoint({ x: centre.x + delta.x, y: centre.y + delta.y })
        schedule()
      },
      zoomBy: (factor) => {
        if (released || !Number.isFinite(factor) || factor <= 0) return
        magnification = Math.max(.5, Math.min(3, magnification * factor))
        schedule()
      },
      highlightPlant: (id) => {
        if (released || id === highlightedId) return
        clearHighlight()
        if (id && state.peek()?.plants.some((plant) => plant.id === id)) {
          highlightedId = id; options.setHoveredTarget({ kind: 'plant', id })
        }
        schedule()
      },
      focusPlant: (id) => {
        if (released) return
        const snapshot = options.getSnapshot()
        const layer = getSceneLayerStyle(snapshot.scene, 'plants')
        if (!layer.visible || layer.opacity === 0) return
        const plant = snapshot.scene.plants.find((entry) => entry.id === id)
        if (!plant) return
        setPoint({ ...plant.position })
        schedule()
      },
      dispose: owned.dispose,
    }
  }
  reset(): void { for (const view of this.views) view.reset() }
  refresh(): void { for (const view of this.views) view.refresh() }
  dispose(): void {
    this.disposed = true
    runCanvasRuntimeCleanups([...this.views].map(view => () => view.dispose()), 'Unable to release Canvas inspection views.')
  }
}
