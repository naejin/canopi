import Konva from 'konva'
import { zoomReference } from '../../state/canvas'
import type { ViewportDeps } from './types'

const DEFAULT_VIEWPORT_METERS = 100
const DEFAULT_FIT_PADDING = 0.1
const ZOOM_FACTOR = 1.1
const ZOOM_MIN = 0.1
const ZOOM_MAX = 200
const FIT_LAYER_NAMES = ['contours', 'climate', 'zones', 'water', 'plants', 'annotations'] as const

export class CanvasViewport {
  private _resizeObserver: ResizeObserver | null = null
  private _resizeRafPending = false
  private _wheelRafId: number | null = null
  private _boundWheelPrevent: ((event: WheelEvent) => void) | null = null
  private _boundStageWheel: ((event: Konva.KonvaEventObject<WheelEvent>) => void) | null = null
  private _boundStageDragMove: ((event: Konva.KonvaEventObject<DragEvent>) => void) | null = null

  constructor(private readonly _deps: ViewportDeps) {}

  init(container: HTMLDivElement, viewportHost: HTMLElement = container): void {
    this._attachWheelHandlers()
    this._attachStagePanHandler()

    this._resizeObserver = new ResizeObserver((entries) => {
      if (this._resizeRafPending) return
      this._resizeRafPending = true
      requestAnimationFrame(() => {
        this._resizeRafPending = false
        const contentRect = entries[0]?.contentRect
        const width = Math.round(contentRect?.width ?? viewportHost.clientWidth)
        const height = Math.round(contentRect?.height ?? viewportHost.clientHeight)
        if (width <= 0 || height <= 0) return
        this._deps.stage.size({
          width,
          height,
        })
        this._deps.invalidateRender('overlays')
      })
    })
    this._resizeObserver.observe(viewportHost)
  }

  initializeViewport(): void {
    this._applyDefaultViewport()
  }

  resetViewport(): void {
    this._applyDefaultViewport()
  }

  zoomIn(): void {
    this._zoomCenter(ZOOM_FACTOR)
  }

  zoomOut(): void {
    this._zoomCenter(1 / ZOOM_FACTOR)
  }

  zoomToFit(): void {
    const nodes: Konva.Node[] = []
    for (const layerName of FIT_LAYER_NAMES) {
      const layer = this._deps.layers.get(layerName)
      if (!layer || !layer.visible()) continue
      layer.find('.shape').forEach((node: Konva.Node) => {
        if (node.isVisible()) nodes.push(node)
      })
    }

    if (nodes.length === 0) return

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of nodes) {
      const rect = node.getClientRect({ relativeTo: this._deps.stage })
      minX = Math.min(minX, rect.x)
      minY = Math.min(minY, rect.y)
      maxX = Math.max(maxX, rect.x + rect.width)
      maxY = Math.max(maxY, rect.y + rect.height)
    }

    const contentWidth = maxX - minX
    const contentHeight = maxY - minY
    if (contentWidth === 0 || contentHeight === 0) return

    const stageWidth = this._deps.stage.width()
    const stageHeight = this._deps.stage.height()
    const scale = Math.min(
      (stageWidth * (1 - DEFAULT_FIT_PADDING * 2)) / contentWidth,
      (stageHeight * (1 - DEFAULT_FIT_PADDING * 2)) / contentHeight,
    )
    const clampedScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))
    const position = {
      x: (stageWidth - contentWidth * clampedScale) / 2 - minX * clampedScale,
      y: (stageHeight - contentHeight * clampedScale) / 2 - minY * clampedScale,
    }

    this._applyViewportTransform(clampedScale, position)
  }

  destroy(): void {
    if (this._wheelRafId !== null) {
      cancelAnimationFrame(this._wheelRafId)
      this._wheelRafId = null
    }

    if (this._boundStageWheel) {
      this._deps.stage.off('wheel', this._boundStageWheel)
      this._boundStageWheel = null
    }

    if (this._boundStageDragMove) {
      this._deps.stage.off('dragmove', this._boundStageDragMove)
      this._boundStageDragMove = null
    }

    const stageContainer = this._deps.stage.container()
    if (this._boundWheelPrevent) {
      stageContainer.removeEventListener('wheel', this._boundWheelPrevent)
      this._boundWheelPrevent = null
    }

    this._resizeObserver?.disconnect()
    this._resizeObserver = null
  }

  private _applyDefaultViewport(): void {
    const stageWidth = this._deps.stage.width()
    const stageHeight = this._deps.stage.height()
    if (stageWidth <= 0 || stageHeight <= 0) return

    const scale = Math.min(stageWidth, stageHeight) / DEFAULT_VIEWPORT_METERS
    const position = {
      x: stageWidth / 2 - (DEFAULT_VIEWPORT_METERS / 2) * scale,
      y: stageHeight / 2 - (DEFAULT_VIEWPORT_METERS / 2) * scale,
    }

    this._deps.applyStageTransform(scale, position, { invalidateDeferred: true })
    zoomReference.value = scale
  }

  private _attachWheelHandlers(): void {
    const stageContainer = this._deps.stage.container()
    this._boundWheelPrevent = (event) => {
      event.preventDefault()
    }
    stageContainer.addEventListener('wheel', this._boundWheelPrevent, { passive: false })

    this._boundStageWheel = (event) => {
      if (this._wheelRafId !== null) return

      this._wheelRafId = requestAnimationFrame(() => {
        this._wheelRafId = null

        const oldScale = this._deps.stage.scaleX()
        const pointer = this._deps.stage.getPointerPosition()
        if (!pointer) return

        const worldPoint = {
          x: (pointer.x - this._deps.stage.x()) / oldScale,
          y: (pointer.y - this._deps.stage.y()) / oldScale,
        }

        let direction = event.evt.deltaY < 0 ? 1 : -1
        if (event.evt.ctrlKey) direction = -direction

        const rawScale = direction > 0 ? oldScale * ZOOM_FACTOR : oldScale / ZOOM_FACTOR
        const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rawScale))
        const position = {
          x: pointer.x - worldPoint.x * newScale,
          y: pointer.y - worldPoint.y * newScale,
        }

        this._applyViewportTransform(newScale, position, { invalidateDeferred: true })
      })
    }

    this._deps.stage.on('wheel', this._boundStageWheel)
  }

  private _attachStagePanHandler(): void {
    this._boundStageDragMove = (event) => {
      if (event.target !== this._deps.stage) return
      this._deps.invalidateRender('overlays')
    }

    this._deps.stage.on('dragmove', this._boundStageDragMove)
  }

  private _zoomCenter(factor: number): void {
    const oldScale = this._deps.stage.scaleX()
    const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, oldScale * factor))
    const centerX = this._deps.stage.width() / 2
    const centerY = this._deps.stage.height() / 2
    const worldPoint = {
      x: (centerX - this._deps.stage.x()) / oldScale,
      y: (centerY - this._deps.stage.y()) / oldScale,
    }

    this._applyViewportTransform(newScale, {
      x: centerX - worldPoint.x * newScale,
      y: centerY - worldPoint.y * newScale,
    }, {
      invalidateDeferred: true,
    })
  }

  private _applyViewportTransform(
    scale: number,
    position: { x: number; y: number },
    options: { invalidateDeferred?: boolean } = {},
  ): void {
    this._deps.applyStageTransform(scale, position, options)
  }
}
