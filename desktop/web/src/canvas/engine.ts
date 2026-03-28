import Konva from 'konva'
import { effect, signal } from '@preact/signals'
import { t } from '../i18n'
import tooltipStyles from './PlantTooltip.module.css'
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
  guides,
  snapToGuidesEnabled,
  plantDisplayMode,
  plantColorByAttr,
  mapLayerVisible,
  mapStyle,
  designLocation,
  minimapVisible,
  celestialDate,
  currentConsortiums,
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
import { PlantStampTool } from './tools/plant-stamp'
import { ArrowTool } from './tools/arrow'
import { CalloutTool } from './tools/callout'
import { PatternFillTool } from './tools/pattern-fill'
import { SpacingTool } from './tools/spacing'
import { DimensionTool } from './tools/dimension'
import { updateDimensionsForNode } from './dimensions'
import { createGridShape, snapToGrid, refreshGridColors } from './grid'
import { createHtmlRulers, updateHtmlRulers, refreshRulerColors, type HtmlRulers } from './rulers'
import { refreshCanvasTheme } from './theme-refresh'
import { createScaleBar, type ScaleBar } from './scale-bar'
// Compass disabled for MVP
// import { createCompass, type Compass } from './compass'
import type { Compass } from './compass'
import { createPlantNode, updatePlantsLOD, getPlantLOD, updatePlantLabelsForLocale } from './plants'
import { snapToGuides, updateGuideLines, clearSmartGuides, computeSmartGuides, createGuideLine } from './guides'
import { AddGuideCommand } from './commands/guide'
import { alignNodes, distributeNodes, type Alignment, type DistributeAxis } from './alignment'
import { updatePlantDisplay } from './display-modes'
import { createMinimap, type Minimap } from './minimap'
import type { MapLayerState } from './map-layer'
import { computeCelestialData, createCelestialDial, updateCelestialDial } from './celestial'
import { updateConsortiumForPlant } from './consortium-visual'
import { extractGroups, restoreGroups } from './grouping'
import { GroupCommand, UngroupCommand } from './commands/group'
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

  // Plant hover tooltip (HTML overlay)
  private _tooltip: HTMLDivElement | null = null

  // Overlay nodes
  private _gridShape: Konva.Shape | null = null
  private _htmlRulers: HtmlRulers | null = null
  private _scaleBar: ScaleBar | null = null
  private _compass: Compass | null = null
  private _minimap: Minimap | null = null
  private _mapLayer: MapLayerState | null = null
  private _mapModule: typeof import('./map-layer') | null = null
  private _disposeMapEffect: (() => void) | null = null
  private _celestialDial: import('konva').default.Group | null = null
  private _disposeCelestialEffect: (() => void) | null = null
  private _disposeMinimapEffect: (() => void) | null = null
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
  private _disposeDisplayModeEffect: (() => void) | null = null
  /** Cache of species details for thematic coloring — keyed by canonical name */
  private _speciesCache = new Map<string, Record<string, unknown>>()

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

    // Compass disabled for MVP — re-enable when location/bearing features return
    // this._compass = createCompass(this.stage)
    // uiLayer.add(this._compass.group as unknown as Konva.Shape)

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
    this._registerTool(new PlantStampTool())
    this._registerTool(new ArrowTool())
    this._registerTool(new CalloutTool())
    this._registerTool(new PatternFillTool())
    this._registerTool(new SpacingTool())
    this._registerTool(new DimensionTool())

    // Wire up interaction
    this._setupZoom()
    this._setupSpacePan()
    this._setupStageMouseEvents()
    this._setupSnapToDrag()
    this.setupDrop()

    // ---- Plant hover tooltip ------------------------------------------------
    this._tooltip = document.createElement('div')
    this._tooltip.className = tooltipStyles.tooltip!
    this._tooltip.style.display = 'none'
    container.style.position = 'relative'
    container.appendChild(this._tooltip)

    this.stage.on('mouseover', (e: Konva.KonvaEventObject<MouseEvent>) => {
      let node: Konva.Node | null = e.target
      let group: Konva.Group | null = null
      while (node) {
        if (node instanceof Konva.Group && node.hasName('plant-group')) {
          group = node
          break
        }
        node = node.parent
      }
      if (!group || !this._tooltip) return

      const commonName = group.getAttr('data-common-name') as string || ''
      const canonicalName = group.getAttr('data-canonical-name') as string || ''
      const stratum = group.getAttr('data-stratum') as string || ''

      // Build tooltip using safe DOM methods (no innerHTML)
      this._tooltip.textContent = ''

      if (commonName) {
        const nameEl = document.createElement('div')
        nameEl.className = tooltipStyles.name!
        nameEl.textContent = commonName
        this._tooltip.appendChild(nameEl)
      }

      const botEl = document.createElement('div')
      botEl.className = tooltipStyles.botanical!
      const em = document.createElement('em')
      em.textContent = canonicalName
      botEl.appendChild(em)
      this._tooltip.appendChild(botEl)

      if (stratum) {
        const attrEl = document.createElement('div')
        attrEl.className = tooltipStyles.attr!
        attrEl.textContent = `${t('canvas.plantTooltip.stratum')}: ${stratum}`
        this._tooltip.appendChild(attrEl)
      }

      this._tooltip.style.display = 'block'

      const transform = this.stage.getAbsoluteTransform()
      const screenPos = transform.point({ x: group.x(), y: group.y() })
      this._tooltip.style.left = `${screenPos.x + 12}px`
      this._tooltip.style.top = `${screenPos.y - 8}px`
    })

    this.stage.on('mouseout', (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!this._tooltip || e.target === this.stage) return
      let node: Konva.Node | null = e.target
      while (node) {
        if (node instanceof Konva.Group && node.hasName('plant-group')) {
          this._tooltip.style.display = 'none'
          break
        }
        node = node.parent
      }
    })

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
          const transformer = this.stage.findOne('Transformer') as Konva.Transformer | undefined
          refreshCanvasTheme(container, this.layers, transformer ?? null)
          if (this._scaleBar) this._scaleBar.update(this.stage)
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

    // Plant display mode effect — update plant rendering when mode changes
    this._disposeDisplayModeEffect = effect(() => {
      const mode = plantDisplayMode.value
      const colorBy = plantColorByAttr.value
      const plantsLayer = this.layers.get('plants')
      if (!plantsLayer) return
      updatePlantDisplay(plantsLayer, mode, colorBy, this.stage.scaleX(), this._speciesCache)
      // If switching to color-by mode and cache is empty, load species data then re-render
      if (mode === 'color-by' && this._speciesCache.size === 0) {
        void this.loadSpeciesCache('en').then(() => {
          updatePlantDisplay(plantsLayer, mode, colorBy, this.stage.scaleX(), this._speciesCache)
        })
      }
    })

    // Celestial dial effect — update sun/moon display when date or location changes
    this._disposeCelestialEffect = effect(() => {
      const date = celestialDate.value
      const loc = designLocation.value
      if (!date || !loc || !this._compass) {
        // Hide dial
        if (this._celestialDial) {
          this._celestialDial.visible(false)
          this.layers.get('ui')?.batchDraw()
        }
        return
      }
      // Create dial if needed
      if (!this._celestialDial) {
        this._celestialDial = createCelestialDial()
        this._compass.group.add(this._celestialDial)
      }
      this._celestialDial.visible(true)
      const data = computeCelestialData(date, loc.lat, loc.lon)
      updateCelestialDial(this._celestialDial, data)
      this.layers.get('ui')?.batchDraw()
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
    // Update guide line extents to cover the new viewport
    const annLayer = this.layers.get('annotations')
    if (annLayer && guides.value.length > 0) {
      updateGuideLines(annLayer, this.stage)
    }
    // Update minimap
    this._minimap?.update(this.stage, this.layers)
    // Sync map viewport
    this._syncMapViewport()
  }

  /** Sync MapLibre viewport with current Konva stage position/zoom. */
  private _syncMapViewport(): void {
    if (this._mapLayer && this._mapModule && mapLayerVisible.value) {
      void this._mapModule.syncMap(this._mapLayer, this.stage, designLocation.value)
    }
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
        updatePlantsLOD(plantsLayer, getPlantLOD(scale), scale, selectedObjectIds.value)
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

        // Sync map viewport on zoom
        this._syncMapViewport()

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
      // Sync map viewport on pan
      this._syncMapViewport()
    })
  }

  // -------------------------------------------------------------------------
  // Snap-to-grid on shape drag
  // -------------------------------------------------------------------------

  private _setupSnapToDrag(): void {
    this.stage.on('dragmove', (e) => {
      const target = e.target
      // Don't snap stage pans
      if (target === this.stage) return

      let { x, y } = { x: target.x(), y: target.y() }

      // Snap to grid
      if (snapToGridEnabled.value) {
        const snapped = snapToGrid(x, y, gridSize.value)
        x = snapped.x
        y = snapped.y
      }

      // Snap to guides (guides take priority over grid)
      if (snapToGuidesEnabled.value && guides.value.length > 0) {
        const snapped = snapToGuides(x, y, this.stage.scaleX())
        x = snapped.x
        y = snapped.y
      }

      target.position({ x, y })

      // Smart guides — show alignment indicators during drag
      const layer = target.getLayer()
      if (layer) {
        clearSmartGuides(layer)
        const candidates = layer.find('.shape').filter(
          (n: Konva.Node) => n !== target && n.id() !== target.id(),
        )
        const result = computeSmartGuides(target, candidates, this.stage.scaleX())
        if (result.snappedX !== x || result.snappedY !== y) {
          target.position({ x: result.snappedX, y: result.snappedY })
        }
        for (const line of result.lines) {
          layer.add(line as unknown as Konva.Shape)
        }
        layer.batchDraw()
      }
    })

    // Clean up smart guides on drag end + update attached dimensions + consortium hulls
    this.stage.on('dragend', (e) => {
      if (e.target === this.stage) return
      const layer = e.target.getLayer()
      if (layer) clearSmartGuides(layer)
      // Update any dimension lines attached to the moved node
      updateDimensionsForNode(e.target.id(), this.layers, this.stage.scaleX())
      // Update consortium hull if a plant was moved
      if (e.target.hasName('plant-group') && currentConsortiums.value.length > 0) {
        updateConsortiumForPlant(e.target.id(), this, currentConsortiums.value)
      }
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

    // Double-click on callout → edit text. Handled at stage level because
    // AddNodeCommand serializes/recreates nodes, which strips event handlers.
    this.stage.on('dblclick', (e) => {
      let target: Konva.Node | null = e.target
      // Walk up to find the callout group
      while (target && target !== this.stage) {
        if (target.hasName('annotation-callout')) {
          const group = target as Konva.Group
          const textNode = group.findOne('Text') as Konva.Text | undefined
          const bgNode = group.findOne('Rect') as Konva.Rect | undefined
          if (textNode && bgNode) {
            void import('./tools/callout').then((mod) => {
              mod._editCalloutText(group, textNode, bgNode, this)
            })
          }
          return
        }
        target = target.parent
      }
    })
  }

  // -------------------------------------------------------------------------
  // Programmatic zoom (for zoom controls)
  // -------------------------------------------------------------------------

  zoomIn(): void {
    this._zoomCenter(ZOOM_FACTOR)
  }

  zoomOut(): void {
    this._zoomCenter(1 / ZOOM_FACTOR)
  }

  private _zoomCenter(factor: number): void {
    const oldScale = this.stage.scaleX()
    const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, oldScale * factor))
    const centerX = this.stage.width() / 2
    const centerY = this.stage.height() / 2
    const mousePointTo = {
      x: (centerX - this.stage.x()) / oldScale,
      y: (centerY - this.stage.y()) / oldScale,
    }
    this.stage.setAttrs({
      scaleX: newScale,
      scaleY: newScale,
      x: centerX - mousePointTo.x * newScale,
      y: centerY - mousePointTo.y * newScale,
    })
    zoomLevel.value = newScale
    this._redrawOverlays()
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

    // Wire up drag-from-ruler to create guides
    this._htmlRulers.onGuideCreate = (axis: 'h' | 'v', screenPos: number) => {
      const scale = this.stage.scaleX()
      const stagePos = this.stage.position()
      let worldPos: number
      if (axis === 'h') {
        worldPos = (screenPos - stagePos.y) / scale
      } else {
        worldPos = (screenPos - stagePos.x) / scale
      }
      this.addGuide(axis, worldPos)
    }

    // Create minimap in the same container
    this._minimap?.destroy()
    this._minimap = createMinimap(element, this.stage, this.layers)

    // Minimap visibility — react to signal toggle immediately
    this._disposeMinimapEffect?.()
    this._disposeMinimapEffect = effect(() => {
      void minimapVisible.value // subscribe
      this._minimap?.update(this.stage, this.layers)
    })

    // Map visibility + style effects — lazy-load map-layer.ts only when toggled on
    // NOTE: Map integration is incomplete. The toggle controls the MapLibre container
    // visibility but does NOT make the Konva canvas transparent (that caused blank
    // canvas bugs). Full map integration requires solving the transparency/compositing
    // model properly — deferred to a focused map sub-phase.
    this._disposeMapEffect?.()
    this._disposeMapEffect = effect(() => {
      const visible = mapLayerVisible.value
      const style = mapStyle.value
      if (!visible) {
        if (this._mapLayer) this._mapLayer.container.style.display = 'none'
        return
      }
      if (!this._mapModule) {
        void import('./map-layer').then((mod) => {
          this._mapModule = mod
          this._mapLayer?.destroy()
          this._mapLayer = mod.createMapLayer(this.stage.container())
          void mod.syncMap(this._mapLayer, this.stage, designLocation.value)
        }).catch(() => { /* map load failed silently */ })
        return
      }
      if (this._mapLayer) {
        this._mapLayer.container.style.display = 'block'
        void this._mapModule.syncMap(this._mapLayer, this.stage, designLocation.value)
        if (this._mapLayer.map) this._mapModule.setMapStyle(this._mapLayer, style)
      }
    })

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

  toggleSnapToGuides(): void {
    snapToGuidesEnabled.value = !snapToGuidesEnabled.value
  }

  addGuide(axis: 'h' | 'v', position: number): void {
    const guide = { id: crypto.randomUUID(), axis, position }
    const cmd = new AddGuideCommand(guide)
    this.history.execute(cmd, this)
  }

  /** Restore guide visuals after loading a design. */
  restoreGuides(): void {
    const layer = this.layers.get('annotations')
    if (!layer) return
    for (const guide of guides.value) {
      const line = createGuideLine(guide, this.stage)
      layer.add(line as unknown as Konva.Shape)
    }
    layer.batchDraw()
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
  // Align & Distribute
  // -------------------------------------------------------------------------

  alignSelected(alignment: Alignment): void {
    const nodes = this.getSelectedNodes()
    const cmd = alignNodes(nodes, alignment)
    if (cmd) {
      this.history.record(cmd)
      for (const layer of this.layers.values()) layer.batchDraw()
    }
  }

  distributeSelected(axis: DistributeAxis): void {
    const nodes = this.getSelectedNodes()
    const cmd = distributeNodes(nodes, axis)
    if (cmd) {
      this.history.record(cmd)
      for (const layer of this.layers.values()) layer.batchDraw()
    }
  }

  // -------------------------------------------------------------------------
  // Group / Ungroup
  // -------------------------------------------------------------------------

  groupSelectedNodes(): void {
    const cmd = new GroupCommand()
    this.history.execute(cmd, this)
  }

  ungroupSelectedNodes(): void {
    const cmd = new UngroupCommand()
    this.history.execute(cmd, this)
  }

  /** Load species details for thematic coloring. Call before switching to color-by mode. */
  async loadSpeciesCache(locale: string): Promise<void> {
    const plantsLayer = this.layers.get('plants')
    if (!plantsLayer) return
    const names: string[] = []
    plantsLayer.find('.plant-group').forEach((node: Konva.Node) => {
      const name = (node as Konva.Group).getAttr('data-canonical-name') as string
      if (name && !this._speciesCache.has(name)) names.push(name)
    })
    if (names.length === 0) return
    const { getSpeciesBatch } = await import('../ipc/species')
    const details = await getSpeciesBatch(names, locale)
    for (const d of details) {
      this._speciesCache.set(d.canonical_name, d as unknown as Record<string, unknown>)
    }
  }

  getObjectGroups() { return extractGroups(this) }
  restoreObjectGroups(groups: import('../types/design').ObjectGroup[]) { restoreGroups(groups, this) }

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
        id: group.id(),
        canonical_name: group.getAttr('data-canonical-name') as string || '',
        common_name: commonName || null,
        position: group.getAbsolutePosition(plantsLayer),
        rotation: group.rotation() !== 0 ? group.rotation() : null,
        scale: null, // counter-scale is ephemeral (1/stageScale) — never persist
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
    this._disposeDisplayModeEffect?.()
    this._disposeActiveToolEffect = null
    this._disposeLayerVisEffect = null
    this._disposeLayerOpacityEffect = null
    this._disposeGridVisEffect = null
    this._disposeRulerVisEffect = null
    this._disposeThemeEffect = null
    this._disposeLocaleEffect = null
    this._disposeDisplayModeEffect = null

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
    this._minimap?.destroy()
    this._minimap = null
    this._mapLayer?.destroy()
    this._mapLayer = null
    this._disposeMapEffect?.()
    this._disposeMapEffect = null
    this._disposeCelestialEffect?.()
    this._disposeCelestialEffect = null
    this._celestialDial = null
    this._disposeMinimapEffect?.()
    this._disposeMinimapEffect = null

    if (this._tooltip) {
      this._tooltip.remove()
      this._tooltip = null
    }

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
