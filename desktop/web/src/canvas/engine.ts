import Konva from 'konva'
import { effect, signal } from '@preact/signals'
import {
  activeTool,
  zoomLevel,
  layerVisibility,
  layerOpacity,
  gridVisible,
  rulersVisible,
  gridSize,
  snapToGridEnabled,
  selectedObjectIds,
  lockedObjectIds,
} from '../state/canvas'
import { theme, locale, persistCurrentSettings } from '../state/app'
import { serializeNode, recreateNode } from './commands/node-serialization'
import { CanvasHistory } from './history'
import { AddNodeCommand, RemoveNodeCommand, BatchCommand, TransformNodeCommand } from './commands'
import type { TransformAttrs } from './commands'
import type { CanvasTool } from './tools/base'
import { SelectTool } from './tools/select'
import { HandTool } from './tools/hand'
import { RectangleTool } from './tools/rectangle'
import { EllipseTool } from './tools/ellipse'
import { PolygonTool } from './tools/polygon'
import { FreeformTool } from './tools/freeform'
import { LineTool } from './tools/line'
import { TextTool } from './tools/text'
import { MeasureTool } from './tools/measure'
import { createGridShape, snapToGrid, refreshGridColors } from './grid'
import { createHtmlRulers, updateHtmlRulers, refreshRulerColors, type HtmlRulers } from './rulers'
import { createScaleBar, type ScaleBar } from './scale-bar'
import { createCompass, type Compass } from './compass'
import { createPlantNode, updatePlantsLOD, getPlantLOD, updatePlantLabelsForLocale } from './plants'
import { updateAnnotationsForZoom } from './shapes'
import type { PlacedPlant } from '../types/design'

// The 7 named layers in render order (bottom → top)
const LAYER_NAMES = [
  'base',
  'contours',
  'climate',
  'zones',
  'water',
  'plants',
  'annotations',
] as const

// Layers that don't need hit-detection (decorative / future use)
const NON_LISTENING_LAYERS = new Set(['base', 'contours', 'climate'])

const ZOOM_FACTOR = 1.1
const ZOOM_MIN = 0.1
const ZOOM_MAX = 200

export class CanvasEngine {
  stage!: Konva.Stage
  layers: Map<string, Konva.Layer> = new Map()
  toolRegistry: Map<string, CanvasTool> = new Map()
  history: CanvasHistory = new CanvasHistory()

  private _container: HTMLDivElement | null = null
  private _resizeObserver: ResizeObserver | null = null
  private _rafPending = false
  private _spaceHeld = false
  private _wasSpaceDraggable = false

  // Overlay nodes
  private _gridShape: Konva.Shape | null = null
  private _htmlRulers: HtmlRulers | null = null
  private _scaleBar: ScaleBar | null = null
  private _compass: Compass | null = null
  // Shared RAF token for overlay redraws (grid + rulers + ui elements)
  private _overlayRafId: number | null = null

  // LOD debounce timer — fires 150ms after the last zoom event
  private _lodTimeout: number | null = null

  // Disposers for signal effects
  private _disposeActiveToolEffect: (() => void) | null = null
  private _disposeLayerVisEffect: (() => void) | null = null
  private _disposeLayerOpacityEffect: (() => void) | null = null
  private _disposeGridVisEffect: (() => void) | null = null
  private _disposeRulerVisEffect: (() => void) | null = null
  private _disposeThemeEffect: (() => void) | null = null
  private _disposeLocaleEffect: (() => void) | null = null

  // Bound handlers stored for cleanup
  private _boundKeyDown: (e: KeyboardEvent) => void
  private _boundKeyUp: (e: KeyboardEvent) => void
  private _boundWheelPrevent: ((e: WheelEvent) => void) | null = null
  private _boundDragOver: ((e: DragEvent) => void) | null = null
  private _boundDragLeave: ((e: DragEvent) => void) | null = null
  private _boundDrop: ((e: DragEvent) => void) | null = null

  constructor() {
    this._boundKeyDown = this._onKeyDown.bind(this)
    this._boundKeyUp = this._onKeyUp.bind(this)
  }

  // -------------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------------

  init(container: HTMLDivElement, width: number, height: number): void {
    this._container = container

    this.stage = new Konva.Stage({
      container,
      width,
      height,
    })

    // Create content layers in order
    for (const name of LAYER_NAMES) {
      const layer = new Konva.Layer({
        id: name,
        listening: !NON_LISTENING_LAYERS.has(name),
      })
      this.stage.add(layer)
      this.layers.set(name, layer)
    }

    // ---- Grid ----------------------------------------------------------------
    this._gridShape = createGridShape(this.stage)
    this._gridShape.visible(false)  // Hidden until a design is created/loaded
    this.layers.get('base')!.add(this._gridShape as unknown as Konva.Shape)

    // ---- Rulers --------------------------------------------------------------
    this._htmlRulers = null  // Created later via attachRulersTo()

    // ---- UI overlay layer (scale bar + compass) — hidden until design exists
    const uiLayer = new Konva.Layer({ listening: true, id: 'ui', visible: false })
    this.stage.add(uiLayer)
    this.layers.set('ui', uiLayer)

    this._scaleBar = createScaleBar(this.stage)
    uiLayer.add(this._scaleBar.group as unknown as Konva.Shape)

    this._compass = createCompass(this.stage)
    uiLayer.add(this._compass.group as unknown as Konva.Shape)

    // Register built-in tools
    this._registerTool(new SelectTool())
    this._registerTool(new HandTool())
    this._registerTool(new RectangleTool())
    this._registerTool(new EllipseTool())
    this._registerTool(new PolygonTool())
    this._registerTool(new FreeformTool())
    this._registerTool(new LineTool())
    this._registerTool(new TextTool())
    this._registerTool(new MeasureTool())

    // Wire up interaction
    this._setupZoom()
    this._setupSpacePan()
    this._setupStageMouseEvents()
    this._setupSnapToDrag()
    this.setupDrop()

    // Signal effects
    this._disposeActiveToolEffect = effect(() => {
      const name = activeTool.value
      this._applyTool(name)
    })

    this._disposeLayerVisEffect = effect(() => {
      const vis = layerVisibility.value
      for (const [name, layer] of this.layers) {
        // ui layer is always visible; ruler layer managed separately
        if (name === 'ui') continue
        layer.visible(vis[name] ?? true)
      }
    })

    this._disposeLayerOpacityEffect = effect(() => {
      const opacities = layerOpacity.value
      for (const [name, layer] of this.layers) {
        if (name === 'ui') continue
        layer.opacity(opacities[name] ?? 1)
      }
    })

    this._disposeGridVisEffect = effect(() => {
      // Read ALL signals FIRST — @preact/signals only subscribes to signals
      // read during execution. Early returns before signal reads = dead effect.
      const visible = this._chromeEnabled.value && gridVisible.value
      if (!this._gridShape) return
      this._gridShape.visible(visible)
      this.layers.get('base')?.batchDraw()
    })

    this._disposeRulerVisEffect = effect(() => {
      // Read ALL signals FIRST (same reason as above)
      const visible = this._chromeEnabled.value && rulersVisible.value
      if (!this._htmlRulers) return
      const display = visible ? 'block' : 'none'
      this._htmlRulers.hCanvas.style.display = display
      this._htmlRulers.vCanvas.style.display = display
      this._htmlRulers.corner.style.display = display
    })

    // Theme effect — refresh cached CSS token colors and redraw overlays
    this._disposeThemeEffect = effect(() => {
      void theme.value  // subscribe
      const container = this.stage.container()
      if (container) {
        // Defer color refresh slightly so the DOM has applied [data-theme]
        requestAnimationFrame(() => {
          refreshGridColors(container)
          refreshRulerColors(container)
          this._redrawOverlays()
        })
      }
    })

    // Locale effect — update plant common names when language changes
    let lastLocale = locale.peek()
    this._disposeLocaleEffect = effect(() => {
      const newLocale = locale.value
      if (newLocale === lastLocale) return  // skip initial fire
      lastLocale = newLocale
      const plantsLayer = this.layers.get('plants')
      if (plantsLayer) {
        void updatePlantLabelsForLocale(plantsLayer, newLocale)
      }
    })

    // Global keyboard events
    window.addEventListener('keydown', this._boundKeyDown)
    window.addEventListener('keyup', this._boundKeyUp)

    // ResizeObserver — debounced via rAF
    this._resizeObserver = new ResizeObserver(() => {
      if (this._rafPending) return
      this._rafPending = true
      requestAnimationFrame(() => {
        this._rafPending = false
        if (!this._container || !this.stage) return
        const { clientWidth, clientHeight } = this._container
        this.stage.size({ width: clientWidth, height: clientHeight })
        this._scheduleOverlayRedraw()
      })
    })
    this._resizeObserver.observe(container)
  }

  // -------------------------------------------------------------------------
  // Overlay redraw — one-frame debounce shared by zoom, pan, and resize
  // -------------------------------------------------------------------------

  /**
   * Reposition UI overlay elements after a zoom or pan.
   * Rulers are HTML elements — just redraw them.
   * Scale bar and compass use per-node world-coord positioning — call update().
   * The UI layer itself stays at identity transform.
   */
  private _syncOverlayTransforms(): void {
    if (!this.stage) return
    if (this._htmlRulers) updateHtmlRulers(this._htmlRulers, this.stage)
    if (this._scaleBar) this._scaleBar.update(this.stage)
    if (this._compass) this._compass.update(this.stage)
  }

  /** Schedule a full overlay repaint (grid + rulers + UI). Used by theme changes and resize. */
  private _scheduleOverlayRedraw(): void {
    if (this._overlayRafId !== null) return
    this._overlayRafId = requestAnimationFrame(() => {
      this._overlayRafId = null
      this._redrawOverlays()
    })
  }

  private _redrawOverlays(): void {
    if (!this.stage) return
    this._syncOverlayTransforms()
    this.layers.get('base')?.batchDraw()
    this.layers.get('ui')?.batchDraw()
  }

  // -------------------------------------------------------------------------
  // LOD update — debounced 150ms after zoom stops
  // -------------------------------------------------------------------------

  private _scheduleLODUpdate(): void {
    if (this._lodTimeout !== null) clearTimeout(this._lodTimeout)
    this._lodTimeout = window.setTimeout(() => {
      this._lodTimeout = null
      const scale = zoomLevel.value
      const plantsLayer = this.layers.get('plants')
      if (plantsLayer) {
        updatePlantsLOD(plantsLayer, getPlantLOD(scale), scale)
      }
      const annotationsLayer = this.layers.get('annotations')
      if (annotationsLayer) {
        updateAnnotationsForZoom(annotationsLayer, scale)
      }
    }, 150)
  }

  // -------------------------------------------------------------------------
  // Zoom
  // -------------------------------------------------------------------------

  private _setupZoom(): void {
    let rafId: number | null = null

    // DOM-level listener with { passive: false } so we can call preventDefault()
    // before the WebView's native Ctrl+scroll page-zoom fires (Linux/Wayland).
    // This must be a raw DOM listener — Konva's internal listener uses passive.
    const container = this.stage.container()
    this._boundWheelPrevent = (e: WheelEvent) => {
      // Always prevent the browser from handling wheel events over the canvas:
      // page zoom (Ctrl+scroll) and scroll-container scrolling both interfere.
      e.preventDefault()
    }
    container.addEventListener('wheel', this._boundWheelPrevent, { passive: false })

    this.stage.on('wheel', (e) => {
      // preventDefault is already called by the DOM listener above.

      if (rafId !== null) {
        // Drop intermediate wheel events — only process one per animation frame
        return
      }

      rafId = requestAnimationFrame(() => {
        rafId = null

        const oldScale = this.stage.scaleX()
        const pointer = this.stage.getPointerPosition()
        if (!pointer) return

        const mousePointTo = {
          x: (pointer.x - this.stage.x()) / oldScale,
          y: (pointer.y - this.stage.y()) / oldScale,
        }

        // Scroll up (deltaY < 0) = zoom in, scroll down = zoom out.
        // Matches Figma, Google Maps, Miro, AutoCAD convention.
        // Trackpad pinch sends ctrlKey=true with inverted deltaY sign convention.
        let direction = e.evt.deltaY < 0 ? 1 : -1
        if (e.evt.ctrlKey) direction = -direction

        const rawScale = direction > 0 ? oldScale * ZOOM_FACTOR : oldScale / ZOOM_FACTOR
        const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rawScale))

        const newPos = {
          x: pointer.x - mousePointTo.x * newScale,
          y: pointer.y - mousePointTo.y * newScale,
        }

        // Batch both property changes into one setAttrs call to avoid 2 draws
        this.stage.setAttrs({ scaleX: newScale, scaleY: newScale, x: newPos.x, y: newPos.y })

        // Sync overlay positions NOW (same frame) — no deferred RAF
        this._syncOverlayTransforms()
        this.layers.get('ui')?.batchDraw()

        // Instant plant scale update — counter-scale all plant groups so they
        // stay fixed screen size. ONE scale per group, no per-child iteration.
        // This is synchronous (same frame) for zero-lag visual feedback.
        const inv = 1 / newScale
        const plantsLayer = this.layers.get('plants')
        if (plantsLayer) {
          plantsLayer.find('.plant-group').forEach((node: Konva.Node) => {
            (node as Konva.Group).scale({ x: inv, y: inv })
          })
          plantsLayer.batchDraw()
        }

        zoomLevel.value = newScale

        // Debounced: LOD visibility changes (label show/hide) — less urgent
        this._scheduleLODUpdate()
      })
    })

    // Pan (stage drag only) — sync overlays when the STAGE moves (viewport change).
    // CRITICAL: only fire for stage-level drags (hand tool panning), NOT for
    // shape drags. Konva's dragmove bubbles from shapes to stage — filtering
    // by e.target prevents heavy overlay redraws on every pixel of shape drag.
    this.stage.on('dragmove', (e) => {
      if (e.target !== this.stage) return  // shape drag — skip overlay sync
      this._syncOverlayTransforms()
      this.layers.get('ui')?.batchDraw()
    })
  }

  // -------------------------------------------------------------------------
  // Snap-to-grid on shape drag
  // -------------------------------------------------------------------------

  private _setupSnapToDrag(): void {
    this.stage.on('dragmove', (e) => {
      if (!snapToGridEnabled.value) return
      const target = e.target
      // Don't snap stage pans
      if (target === this.stage) return
      const snapped = snapToGrid(target.x(), target.y(), gridSize.value)
      target.position(snapped)
    })
  }

  // -------------------------------------------------------------------------
  // Space-bar pan (temporary draggable override)
  // -------------------------------------------------------------------------

  private _setupSpacePan(): void {
    // Actual key handling is in _onKeyDown / _onKeyUp (window listeners)
  }

  private _onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space' && !this._spaceHeld) {
      this._spaceHeld = true
      this._wasSpaceDraggable = this.stage.draggable()
      this.stage.draggable(true)
      const container = this.stage.container()
      if (container) container.style.cursor = 'grab'
    }

    // Forward to active tool
    const tool = this.toolRegistry.get(activeTool.value)
    if (tool?.onKeyDown) {
      tool.onKeyDown(e, this)
    }
  }

  private _onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      this._spaceHeld = false
      // Only revert if the current tool doesn't want draggable
      this.stage.draggable(this._wasSpaceDraggable)
      const tool = this.toolRegistry.get(activeTool.value)
      const container = this.stage.container()
      if (container) container.style.cursor = tool?.cursor ?? 'default'
    }
  }

  // -------------------------------------------------------------------------
  // Stage-level mouse event routing
  // -------------------------------------------------------------------------

  private _setupStageMouseEvents(): void {
    this.stage.on('mousedown', (e) => {
      const tool = this.toolRegistry.get(activeTool.value)
      tool?.onMouseDown(e, this)
    })

    this.stage.on('mousemove', (e) => {
      const tool = this.toolRegistry.get(activeTool.value)
      tool?.onMouseMove(e, this)
    })

    this.stage.on('mouseup', (e) => {
      const tool = this.toolRegistry.get(activeTool.value)
      tool?.onMouseUp(e, this)
    })
  }

  // -------------------------------------------------------------------------
  // Zoom to fit
  // -------------------------------------------------------------------------

  zoomToFit(): void {
    const nodes: Konva.Node[] = []
    for (const layer of this.layers.values()) {
      if (layer.visible()) {
        layer.getChildren().forEach((child) => nodes.push(child))
      }
    }

    if (nodes.length === 0) return

    // Compute bounding box in stage (unscaled) coordinates
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const node of nodes) {
      const rect = node.getClientRect({ relativeTo: this.stage })
      minX = Math.min(minX, rect.x)
      minY = Math.min(minY, rect.y)
      maxX = Math.max(maxX, rect.x + rect.width)
      maxY = Math.max(maxY, rect.y + rect.height)
    }

    const contentW = maxX - minX
    const contentH = maxY - minY
    if (contentW === 0 || contentH === 0) return

    const stageW = this.stage.width()
    const stageH = this.stage.height()
    const padding = 0.1 // 10% padding on each side

    const scale = Math.min(
      (stageW * (1 - padding * 2)) / contentW,
      (stageH * (1 - padding * 2)) / contentH,
    )
    const clampedScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))

    const newX = (stageW - contentW * clampedScale) / 2 - minX * clampedScale
    const newY = (stageH - contentH * clampedScale) / 2 - minY * clampedScale

    this.stage.scale({ x: clampedScale, y: clampedScale })
    this.stage.position({ x: newX, y: newY })
    zoomLevel.value = clampedScale

    this._scheduleOverlayRedraw()
  }

  // -------------------------------------------------------------------------
  // Grid / overlay public API (called from CanvasToolbar toggle buttons)
  // -------------------------------------------------------------------------

  /**
   * Attach HTML rulers to an external container element.
   * Must be called after init() — the container should be the position:relative
   * wrapper div that sits ABOVE the Konva container in the DOM, so the rulers
   * overlay the canvas without being clipped by Konva's internal structure.
   */
  attachRulersTo(element: HTMLElement): void {
    this._htmlRulers?.destroy()
    refreshRulerColors(element)
    this._htmlRulers = createHtmlRulers(element)
    // Apply current visibility — rulers are created with display:block by default,
    // but if chrome is disabled (no design yet) they should be hidden immediately.
    const visible = this._chromeEnabled.value && rulersVisible.value
    const display = visible ? 'block' : 'none'
    this._htmlRulers.hCanvas.style.display = display
    this._htmlRulers.vCanvas.style.display = display
    this._htmlRulers.corner.style.display = display
    this._syncOverlayTransforms()
  }

  /** Show grid, rulers, compass, scale bar — call when a design is created or loaded. */
  /** Track whether canvas chrome (grid, rulers, compass) should be visible.
   *  This is a signal so that effects automatically re-run when it changes.
   *  Individual toggle signals (gridVisible, rulersVisible) are respected
   *  only when chrome is enabled. */
  private _chromeEnabled = signal(false)

  showCanvasChrome(): void {
    this._chromeEnabled.value = true  // Effects auto-fire, showing grid/rulers
    const uiLayer = this.layers.get('ui')
    if (uiLayer) { uiLayer.visible(true); uiLayer.batchDraw() }
    this._syncOverlayTransforms()
  }

  /** Hide ALL canvas chrome — called when no design is active. */
  hideCanvasChrome(): void {
    this._chromeEnabled.value = false  // Effects auto-fire, hiding grid/rulers
    const uiLayer = this.layers.get('ui')
    if (uiLayer) { uiLayer.visible(false); uiLayer.batchDraw() }
  }

  setGridSize(size: number): void {
    gridSize.value = size
    this._redrawOverlays()
  }

  toggleSnapToGrid(): void {
    snapToGridEnabled.value = !snapToGridEnabled.value
    persistCurrentSettings()
  }

  toggleGrid(): void {
    gridVisible.value = !gridVisible.value
    // The _disposeGridVisEffect signal effect handles visibility + batchDraw
  }

  toggleRulers(): void {
    rulersVisible.value = !rulersVisible.value
    // The _disposeRulerVisEffect signal effect handles visibility + batchDraw
  }

  setLayerVisibility(name: string, visible: boolean): void {
    const current = { ...layerVisibility.value }
    current[name] = visible
    layerVisibility.value = current
  }

  setLayerOpacity(name: string, opacity: number): void {
    const current = { ...layerOpacity.value }
    current[name] = opacity
    layerOpacity.value = current
  }

  // -------------------------------------------------------------------------
  // Tool management
  // -------------------------------------------------------------------------

  private _registerTool(tool: CanvasTool): void {
    this.toolRegistry.set(tool.name, tool)
  }

  setActiveTool(name: string): void {
    activeTool.value = name
  }

  private _applyTool(name: string): void {
    // Deactivate all tools except the new one
    for (const [toolName, tool] of this.toolRegistry) {
      if (toolName !== name) {
        tool.deactivate(this)
      }
    }
    const next = this.toolRegistry.get(name)
    if (next) {
      next.activate(this)
      const container = this.stage.container()
      if (container && !this._spaceHeld) {
        container.style.cursor = next.cursor
      }
    }

    // When a drawing tool is active, shapes must not be draggable — otherwise
    // Konva starts its internal drag on mousedown before the tool's handler
    // fires, causing the shape to move AND a new shape to be drawn simultaneously.
    // Select tool re-enables draggable so shapes can be moved normally.
    const isSelectTool = name === 'select'
    for (const layer of this.layers.values()) {
      layer.find('.shape').forEach((node) => {
        node.draggable(isSelectTool)
      })
    }
  }

  // -------------------------------------------------------------------------
  // Drop target — Plant DB → Canvas (drag-and-drop plant placement)
  // -------------------------------------------------------------------------

  setupDrop(): void {
    const container = this.stage.container()
    if (!container) return

    // Ghost preview node — created once on first dragover, repositioned on
    // subsequent events, destroyed on dragleave or drop.
    let ghostNode: Konva.Group | null = null

    const plantsLayer = (): Konva.Layer | undefined => this.layers.get('plants')

    const removeGhost = (): void => {
      if (ghostNode) {
        ghostNode.destroy()
        ghostNode = null
        plantsLayer()?.batchDraw()
      }
    }

    // Parse plant drag payload — returns null if the data is not a valid plant
    const parseDragData = (e: DragEvent): {
      canonical_name: string
      common_name: string | null
      stratum: string | null
      width_max_m: number | null
    } | null => {
      let raw: string | null = null
      try { raw = e.dataTransfer!.getData('text/plain') } catch { return null }
      if (!raw) return null
      try {
        const data = JSON.parse(raw)
        if (typeof data.canonical_name !== 'string') return null
        return {
          canonical_name: data.canonical_name as string,
          common_name: typeof data.common_name === 'string' ? data.common_name : null,
          stratum: typeof data.stratum === 'string' ? data.stratum : null,
          width_max_m: typeof data.width_max_m === 'number' ? data.width_max_m : null,
        }
      } catch { return null }
    }

    // Convert a DOM-space DragEvent position to canvas world coordinates
    const domToCanvas = (e: DragEvent): { x: number; y: number } | null => {
      const rect = container.getBoundingClientRect()
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top
      const scale = this.stage.scaleX()
      return {
        x: (screenX - this.stage.x()) / scale,
        y: (screenY - this.stage.y()) / scale,
      }
    }

    // Store handlers as instance fields so they can be removed in destroy().
    this._boundDragOver = (e: DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'

      const pos = domToCanvas(e)
      if (!pos) return

      // We can't reliably read dataTransfer payload during dragover (browser
      // security restriction), so use a generic placeholder if no ghost exists.
      if (!ghostNode) {
        // Create a small ghost circle matching the fixed-size plant style
        const inv = 1 / this.stage.scaleX()
        const ghost = new Konva.Group({
          x: pos.x,
          y: pos.y,
          listening: false,
          opacity: 0.5,
          name: 'plant-ghost',
        })
        const ghostCircle = new Konva.Circle({
          radius: 8,  // screen pixels
          fill: '#4CAF50',
          opacity: 0.5,
          stroke: '#4CAF50',
          strokeWidth: 1.5,
          strokeScaleEnabled: false,
        })
        ghostCircle.scale({ x: inv, y: inv })
        ghost.add(ghostCircle)
        ghostNode = ghost
        plantsLayer()?.add(ghostNode as unknown as Konva.Shape)
      }

      ghostNode.position(pos)
      plantsLayer()?.batchDraw()
    }

    this._boundDragLeave = (_e: DragEvent) => {
      removeGhost()
    }

    this._boundDrop = (e: DragEvent) => {
      e.preventDefault()

      removeGhost()

      const data = parseDragData(e)
      if (!data) return

      const pos = domToCanvas(e)
      if (!pos) return

      const plantNode = createPlantNode({
        id: crypto.randomUUID(),
        canonicalName: data.canonical_name,
        commonName: data.common_name,
        stratum: data.stratum,
        canopySpreadM: data.width_max_m,
        position: pos,
        stageScale: this.stage.scaleX(),
      })

      const cmd = new AddNodeCommand('plants', plantNode)
      this.history.execute(cmd, this)
    }

    container.addEventListener('dragover', this._boundDragOver)
    container.addEventListener('dragleave', this._boundDragLeave)
    container.addEventListener('drop', this._boundDrop)
  }

  // -------------------------------------------------------------------------
  // Layer / node helpers (used by drawing tools)
  // -------------------------------------------------------------------------

  /** Return the appropriate layer for a given tool name. */
  getLayerForTool(toolName: string): Konva.Layer {
    const zoneTools = new Set(['rectangle', 'ellipse', 'polygon', 'freeform'])
    const layerName = zoneTools.has(toolName) ? 'zones' : 'annotations'
    return this.layers.get(layerName)!
  }

  /** Add a node to a named layer and redraw. */
  addNode(layerName: string, node: Konva.Node): void {
    const layer = this.layers.get(layerName)
    if (layer) {
      // Konva Layer.add() signature is Shape|Group; cast through unknown to satisfy TS.
      layer.add(node as unknown as Konva.Shape)
      layer.batchDraw()
    }
  }

  /** Remove a node by id from whichever layer contains it. */
  removeNode(nodeId: string): void {
    for (const layer of this.layers.values()) {
      const node = layer.findOne('#' + nodeId)
      if (node) {
        node.destroy()
        layer.batchDraw()
        return
      }
    }
  }

  // -------------------------------------------------------------------------
  // Object operations
  // -------------------------------------------------------------------------

  /** Clipboard — module-level (not system clipboard) */
  private _clipboard: string | null = null

  /** Return all Konva nodes that match the current selectedObjectIds signal. */
  getSelectedNodes(): Konva.Node[] {
    const ids = selectedObjectIds.value
    const nodes: Konva.Node[] = []
    for (const layer of this.layers.values()) {
      layer.find('.shape').forEach((node) => {
        if (ids.has(node.id())) nodes.push(node)
      })
    }
    return nodes
  }

  /** Delete all selected nodes through history (supports undo). */
  deleteSelected(): void {
    const nodes = this.getSelectedNodes()
    if (nodes.length === 0) return

    // Build remove commands before destroying anything
    const cmds = nodes.map((node) => {
      const layer = node.getLayer()
      const layerName = layer?.id() ?? 'annotations'
      return new RemoveNodeCommand(layerName, node)
    })

    selectedObjectIds.value = new Set()

    const batch = new BatchCommand(cmds)
    this.history.execute(batch, this)
  }

  /** Duplicate selected nodes with a +20 px offset and select the copies (supports undo). */
  duplicateSelected(): void {
    const nodes = this.getSelectedNodes()
    if (nodes.length === 0) return

    const cmds: AddNodeCommand[] = []
    const newIds = new Set<string>()

    for (const node of nodes) {
      const clone = node.clone({ id: crypto.randomUUID() }) as Konva.Node
      clone.x(clone.x() + 20)
      clone.y(clone.y() + 20)
      const layer = node.getLayer()
      const layerName = layer?.id() ?? 'annotations'
      cmds.push(new AddNodeCommand(layerName, clone))
      newIds.add(clone.id())
      // Destroy the temporary clone — AddNodeCommand will recreate it from serialized attrs
      clone.destroy()
    }

    selectedObjectIds.value = newIds

    const batch = new BatchCommand(cmds)
    this.history.execute(batch, this)
  }

  /** Serialize selected nodes to internal clipboard. */
  copyToClipboard(): void {
    const nodes = this.getSelectedNodes()
    if (nodes.length === 0) return
    // Use the recursive serializer that captures Group children (plants, measures)
    const data = nodes.map((n) => serializeNode(n))
    this._clipboard = JSON.stringify(data)
  }

  /** Paste clipboard contents with +20 px offset, select the new nodes. */
  pasteFromClipboard(): void {
    if (!this._clipboard) return
    let items: ReturnType<typeof serializeNode>[]
    try { items = JSON.parse(this._clipboard) } catch { return }
    if (items.length === 0) return

    const cmds: AddNodeCommand[] = []
    const newIds = new Set<string>()

    for (const item of items) {
      // Assign a new ID and offset position
      const id = crypto.randomUUID()
      item.attrs.id = id
      item.attrs.x = ((item.attrs.x as number) || 0) + 20
      item.attrs.y = ((item.attrs.y as number) || 0) + 20

      // Recreate the full node including children (plant circles, labels, etc.)
      const node = recreateNode(item)

      // Determine which layer to add to based on the node's name
      let layerName = 'zones'
      if (node.hasName('plant-group')) layerName = 'plants'
      else if (node.hasName('annotation-text') || node.hasName('measure-label')) layerName = 'annotations'
      else if (node.getClassName() === 'Text') layerName = 'annotations'

      cmds.push(new AddNodeCommand(layerName, node))
      newIds.add(id)
      // Destroy the temporary live node — AddNodeCommand serialized it above
      node.destroy()
    }

    if (cmds.length > 0) {
      this.history.execute(new BatchCommand(cmds), this)
    }
    selectedObjectIds.value = newIds
  }

  /** Rotate all selected nodes by the given number of degrees. */
  rotateSelected(degrees: number): void {
    const nodes = this.getSelectedNodes()
    if (nodes.length === 0) return
    const cmds = nodes.map(node => {
      const oldAttrs = { rotation: node.rotation() } as TransformAttrs
      node.rotation(node.rotation() + degrees)
      const newAttrs = { rotation: node.rotation() } as TransformAttrs
      return new TransformNodeCommand(node.id(), oldAttrs, newAttrs)
    })
    this.history.record(new BatchCommand(cmds))
    for (const layer of this.layers.values()) layer.batchDraw()
  }

  /** Flip selected nodes along the given axis. */
  flipSelected(axis: 'h' | 'v'): void {
    const nodes = this.getSelectedNodes()
    if (nodes.length === 0) return
    const cmds = nodes.map(node => {
      const oldAttrs = { scaleX: node.scaleX(), scaleY: node.scaleY() } as TransformAttrs
      if (axis === 'h') node.scaleX(node.scaleX() * -1)
      else              node.scaleY(node.scaleY() * -1)
      const newAttrs = { scaleX: node.scaleX(), scaleY: node.scaleY() } as TransformAttrs
      return new TransformNodeCommand(node.id(), oldAttrs, newAttrs)
    })
    this.history.record(new BatchCommand(cmds))
    for (const layer of this.layers.values()) layer.batchDraw()
  }

  /** Move selected nodes to the top of their layer's z-order.
   *  Note: z-order undo is a Phase 3 item — these operations are not undoable. */
  bringToFront(): void {
    const nodes = this.getSelectedNodes()
    if (nodes.length === 0) return
    const affectedLayers = new Set<Konva.Layer>()
    for (const node of nodes) {
      node.moveToTop()
      const layer = node.getLayer()
      if (layer) affectedLayers.add(layer)
    }
    for (const layer of affectedLayers) layer.batchDraw()
  }

  /** Move selected nodes to the bottom of their layer's z-order.
   *  Note: z-order undo is a Phase 3 item — these operations are not undoable. */
  sendToBack(): void {
    const nodes = this.getSelectedNodes()
    if (nodes.length === 0) return
    const affectedLayers = new Set<Konva.Layer>()
    for (const node of nodes) {
      node.moveToBottom()
      const layer = node.getLayer()
      if (layer) affectedLayers.add(layer)
    }
    for (const layer of affectedLayers) layer.batchDraw()
  }

  /**
   * Lock the currently selected nodes — they become unselectable/undraggable
   * and are deselected immediately.
   */
  lockSelected(): void {
    const ids = selectedObjectIds.value
    if (ids.size === 0) return
    const locked = new Set(lockedObjectIds.value)
    for (const id of ids) {
      locked.add(id)
      for (const layer of this.layers.values()) {
        const node = layer.findOne('#' + id)
        if (node) { node.draggable(false); break }
      }
    }
    lockedObjectIds.value = locked
    selectedObjectIds.value = new Set()
  }

  /**
   * Unlock all locked nodes — locked nodes cannot be individually selected,
   * so this always unlocks the entire locked set.
   */
  unlockSelected(): void {
    const locked = lockedObjectIds.value
    for (const id of locked) {
      for (const layer of this.layers.values()) {
        const node = layer.findOne('#' + id)
        if (node) { node.draggable(true); break }
      }
    }
    lockedObjectIds.value = new Set()
  }

  /** Select all unlocked nodes on all visible layers in a single pass. */
  selectAll(): void {
    const locked = lockedObjectIds.value
    const ids = new Set<string>()
    for (const layer of this.layers.values()) {
      if (!layer.visible()) continue
      layer.find('.shape').forEach((node) => {
        if (!locked.has(node.id())) ids.add(node.id())
      })
    }
    selectedObjectIds.value = ids
  }

  // -------------------------------------------------------------------------
  // Plant serialization
  // -------------------------------------------------------------------------

  /** Collect all placed plant nodes for design file serialization. */
  getPlacedPlants(): PlacedPlant[] {
    const plantsLayer = this.layers.get('plants')
    if (!plantsLayer) return []

    const result: PlacedPlant[] = []
    plantsLayer.find('.plant-group').forEach((node: Konva.Node) => {
      const group = node as Konva.Group
      const commonName = group.getAttr('data-common-name') as string || null
      result.push({
        canonical_name: group.getAttr('data-canonical-name') as string || '',
        common_name: commonName || null,
        position: { x: group.x(), y: group.y() },
        rotation: group.rotation() !== 0 ? group.rotation() : null,
        scale: group.scaleX() !== 1 ? group.scaleX() : null,
        notes: group.getAttr('data-notes') ?? null,
        planted_date: group.getAttr('data-planted-date') ?? null,
        quantity: group.getAttr('data-quantity') ?? null,
      })
    })
    return result
  }

  // -------------------------------------------------------------------------
  // Undo / Redo
  // -------------------------------------------------------------------------

  undo(): void {
    this.history.undo(this)
  }

  redo(): void {
    this.history.redo(this)
  }

  // -------------------------------------------------------------------------
  // Destroy
  // -------------------------------------------------------------------------

  destroy(): void {
    this._disposeActiveToolEffect?.()
    this._disposeLayerVisEffect?.()
    this._disposeLayerOpacityEffect?.()
    this._disposeGridVisEffect?.()
    this._disposeRulerVisEffect?.()
    this._disposeThemeEffect?.()
    this._disposeLocaleEffect?.()
    this._disposeActiveToolEffect = null
    this._disposeLayerVisEffect = null
    this._disposeLayerOpacityEffect = null
    this._disposeGridVisEffect = null
    this._disposeRulerVisEffect = null
    this._disposeThemeEffect = null
    this._disposeLocaleEffect = null

    if (this._overlayRafId !== null) {
      cancelAnimationFrame(this._overlayRafId)
      this._overlayRafId = null
    }

    if (this._lodTimeout !== null) {
      clearTimeout(this._lodTimeout)
      this._lodTimeout = null
    }

    this._resizeObserver?.disconnect()
    this._resizeObserver = null

    window.removeEventListener('keydown', this._boundKeyDown)
    window.removeEventListener('keyup', this._boundKeyUp)

    if (this._container) {
      if (this._boundWheelPrevent) {
        this._container.removeEventListener('wheel', this._boundWheelPrevent)
        this._boundWheelPrevent = null
      }
      if (this._boundDragOver) {
        this._container.removeEventListener('dragover', this._boundDragOver)
        this._boundDragOver = null
      }
      if (this._boundDragLeave) {
        this._container.removeEventListener('dragleave', this._boundDragLeave)
        this._boundDragLeave = null
      }
      if (this._boundDrop) {
        this._container.removeEventListener('drop', this._boundDrop)
        this._boundDrop = null
      }
    }

    // Deactivate current tool cleanly
    const currentTool = this.toolRegistry.get(activeTool.value)
    currentTool?.deactivate(this)

    this._htmlRulers?.destroy()
    this._htmlRulers = null

    this.stage.destroy()
    this.layers.clear()
    this.toolRegistry.clear()
    this.history.clear()
    this._container = null
    this._gridShape = null
    this._scaleBar = null
    this._compass = null
  }
}

// TODO(Phase 3): Add MapLibre GL JS background layer — mount a MapLibre map
// in a DOM element positioned behind the Konva stage and sync pan/zoom.

// TODO(Phase 3): Add native file-watcher integration (lib-c/lib-swift/lib-cpp)
// to detect external edits to the open .canopi file and prompt for reload.

// TODO(Phase 3): Add collaborative editing via CRDT (e.g., Automerge) so that
// multiple users can co-edit the same design in real time.

// Module-level instance — assigned by CanvasPanel, exported for external access
export let canvasEngine: CanvasEngine | null = null

export function setCanvasEngine(engine: CanvasEngine | null): void {
  canvasEngine = engine
}
