import Konva from 'konva'
import { effect, signal } from '@preact/signals'
import { t } from '../i18n'
import tooltipStyles from './PlantTooltip.module.css'
import {
  activeTool,
  layerVisibility,
  layerOpacity,
  gridVisible,
  rulersVisible,
  gridSize,
  snapToGridEnabled,
  guides,
  snapToGuidesEnabled,
  plantColorMenuOpen,
  plantSpeciesColors,
  plantDisplayMode,
  plantColorByAttr,
} from '../state/canvas'
import { theme, locale, persistCurrentSettings } from '../state/app'
import { CanvasHistory } from './history'
import type { CanvasTool } from './tools/base'
import { SelectTool } from './tools/select'
import { HandTool } from './tools/hand'
import { RectangleTool } from './tools/rectangle'
import { TextTool } from './tools/text'
import { PlantStampTool } from './tools/plant-stamp'
import { createGridShape, snapToGrid } from './grid'
import { createHtmlRulers, refreshRulerColors, setHtmlOverlayVisibility, type HtmlRulers } from './rulers'
import { snapToGuides, createGuideLine } from './guides'
import { AddGuideCommand } from './commands/guide'
import { BatchCommand, SetPlantColorCommand, SetPlantSpeciesColorCommand } from './commands'
import type { Alignment, DistributeAxis } from './alignment'
import type { CanopiFile, ObjectGroup, PlacedPlant } from '../types/design'
import type { CanvasToolEngine, Command, PlantPlacementSpec } from './contracts'
import { CanvasRenderPipeline } from './runtime/render-pipeline'
import type { RenderPass } from './runtime/render-passes'
import { CanvasViewport } from './runtime/viewport'
import { CanvasObjectOps } from './runtime/object-ops'
import { CanvasExternalInput } from './runtime/external-input'
import { loadDocumentSession, resetTransientCanvasSession } from './runtime/document-session'
import { RenderReconciler } from './runtime/render-reconciler'
import { CanvasSpeciesCache } from './runtime/species-cache'
import { normalizeHexColor } from './plant-colors'
import { createPlantNode } from './plants'

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

export interface SelectedPlantColorContext {
  plantIds: string[]
  singleSpeciesCanonicalName: string | null
  singleSpeciesCommonName: string | null
  sharedCurrentColor: string | null | 'mixed'
  suggestedColor: string | null
  singleSpeciesDefaultColor: string | null
}

export class CanvasEngine implements CanvasToolEngine {
  stage!: Konva.Stage
  layers: Map<string, Konva.Layer> = new Map()
  toolRegistry: Map<string, CanvasTool> = new Map()
  history: CanvasHistory = new CanvasHistory()

  private _spaceHeld = false
  private _wasSpaceDraggable = false

  // Plant hover tooltip (HTML overlay)
  private _tooltip: HTMLDivElement | null = null

  // Overlay nodes
  private _gridShape: Konva.Shape | null = null
  private _htmlRulers: HtmlRulers | null = null
  private _renderPipeline: CanvasRenderPipeline | null = null
  private _renderReconciler: RenderReconciler | null = null
  private _viewport: CanvasViewport | null = null
  private _objectOps: CanvasObjectOps | null = null
  private _externalInput: CanvasExternalInput | null = null

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
  private _speciesCache = new CanvasSpeciesCache()
  private _documentLoadEpoch = 0

  private _lastLocale = locale.peek()

  // -------------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------------

  init(container: HTMLDivElement, width: number, height: number, viewportHost: HTMLElement = container): void {
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

    // ---- UI overlay layer (reserved for future Konva-owned chrome) ----------
    const uiLayer = new Konva.Layer({ listening: true, id: 'ui', visible: false })
    this.stage.add(uiLayer)
    this.layers.set('ui', uiLayer)

    this._renderPipeline = new CanvasRenderPipeline({
      stage: this.stage,
      layers: this.layers,
      getHtmlRulers: () => this._htmlRulers,
      speciesCache: {
        getCache: () => this._speciesCache.getCache(),
        loadVisiblePlantEntries: (plantsLayer, activeLocale) =>
          this._speciesCache.loadVisiblePlantEntries(plantsLayer, activeLocale),
      },
    })
    this._renderReconciler = new RenderReconciler({
      stage: this.stage,
      pipeline: this._renderPipeline,
      getVisiblePlantsForDeferredPasses: () => {
        const plantsLayer = this.layers.get('plants')
        return (plantsLayer?.find('.plant-group') as Konva.Group[]) ?? []
      },
    })

    this._viewport = new CanvasViewport({
      stage: this.stage,
      layers: this.layers,
      applyStageTransform: (scale, position, options) =>
        this.applyStageTransform(scale, position, options),
      invalidateRender: (...passes) => this.invalidateRender(...passes),
    })

    this._objectOps = new CanvasObjectOps({
      stage: this.stage,
      layers: this.layers,
      history: this.history,
      getClipboard: () => this._clipboard,
      setClipboard: (value) => {
        this._clipboard = value
      },
    })

    // Register built-in tools
    this._registerTool(new SelectTool())
    this._registerTool(new HandTool())
    this._registerTool(new RectangleTool())
    this._registerTool(new TextTool())
    this._registerTool(new PlantStampTool())

    // Wire up interaction
    this._viewport.init(container, viewportHost)
    this._setupSnapToDrag()
    this._externalInput = new CanvasExternalInput({
      stage: this.stage,
      layers: this.layers,
      toolRegistry: this.toolRegistry,
      engine: this,
      getSpaceHeld: () => this._spaceHeld,
      setSpaceHeld: (value) => {
        this._spaceHeld = value
      },
      getWasSpaceDraggable: () => this._wasSpaceDraggable,
      setWasSpaceDraggable: (value) => {
        this._wasSpaceDraggable = value
      },
      getActiveToolCursor: () => this.toolRegistry.get(activeTool.value)?.cursor ?? 'default',
      invalidateRender: (...passes) => this.invalidateRender(...passes),
    })
    this._externalInput.init()

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
      this.invalidateRender('overlays')
    })

    this._disposeRulerVisEffect = effect(() => {
      // Read ALL signals FIRST (same reason as above)
      const chromeVisible = this._chromeEnabled.value
      const rulersAreVisible = rulersVisible.value
      if (!this._htmlRulers) return
      setHtmlOverlayVisibility(this._htmlRulers, {
        chromeVisible,
        rulersVisible: rulersAreVisible,
      })
    })

    // Theme effect — refresh cached CSS token colors and redraw overlays
    this._disposeThemeEffect = effect(() => {
      void theme.value
      this.invalidateRender('theme', 'overlays')
    })

    // Locale effect — update plant common names when language changes
    this._disposeLocaleEffect = effect(() => {
      const newLocale = locale.value
      if (newLocale === this._lastLocale) return
      this._lastLocale = newLocale
      this._renderPipeline?.refreshLocale(newLocale)
      this.invalidateRender('density', 'stacking')
    })

    // Plant display mode effect — update plant rendering when mode changes
    this._disposeDisplayModeEffect = effect(() => {
      void plantDisplayMode.value
      void plantColorByAttr.value
      this.invalidateRender('plant-display', 'lod', 'density', 'stacking')
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

      target.getLayer()?.batchDraw()
    })
  }

  // -------------------------------------------------------------------------
  // Programmatic zoom (for zoom controls)
  // -------------------------------------------------------------------------

  zoomIn(): void {
    this._viewport?.zoomIn()
  }

  zoomOut(): void {
    this._viewport?.zoomOut()
  }

  // -------------------------------------------------------------------------
  // Zoom to fit
  // -------------------------------------------------------------------------

  zoomToFit(): void {
    this._viewport?.zoomToFit()
  }

  initializeViewport(): void {
    this._viewport?.initializeViewport()
  }

  resetViewport(): void {
    this._viewport?.resetViewport()
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

    // Apply current visibility — rulers are created with display:block by default,
    // but if chrome is disabled (no design yet) they should be hidden immediately.
    setHtmlOverlayVisibility(this._htmlRulers, {
      chromeVisible: this._chromeEnabled.value,
      rulersVisible: rulersVisible.value,
    })
    this.invalidateRender('overlays')
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
    this.invalidateRender('overlays')
  }

  /** Hide ALL canvas chrome — called when no design is active. */
  hideCanvasChrome(): void {
    this._chromeEnabled.value = false  // Effects auto-fire, hiding grid/rulers
    const uiLayer = this.layers.get('ui')
    if (uiLayer) { uiLayer.visible(false); uiLayer.batchDraw() }
  }

  setGridSize(size: number): void {
    gridSize.value = size
    this.invalidateRender('overlays')
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
  // Layer / node helpers (used by drawing tools)
  // -------------------------------------------------------------------------

  /** Return the appropriate layer for a given tool name. */
  getLayerForTool(toolName: string): Konva.Layer {
    return this._objectOps!.getLayerForTool(toolName)
  }

  /** Add a node to a named layer and redraw. */
  addNode(layerName: string, node: Konva.Node): void {
    this._objectOps!.addNode(layerName, node)
  }

  /** Remove a node by id from whichever layer contains it. */
  removeNode(nodeId: string): void {
    this._objectOps!.removeNode(nodeId)
  }

  // -------------------------------------------------------------------------
  // Object operations
  // -------------------------------------------------------------------------

  /** Clipboard — module-level (not system clipboard) */
  private _clipboard: string | null = null

  /** Return all Konva nodes that match the current selectedObjectIds signal. */
  getSelectedNodes(): Konva.Node[] {
    return this._objectOps!.getSelectedNodes()
  }

  /** Delete all selected nodes through history (supports undo). */
  deleteSelected(): void {
    this._objectOps!.deleteSelected(this)
  }

  /** Duplicate selected nodes with a +20 px offset and select the copies (supports undo). */
  duplicateSelected(): void {
    this._objectOps!.duplicateSelected(this)
  }

  /** Serialize selected nodes to internal clipboard. */
  copyToClipboard(): void {
    this._objectOps!.copyToClipboard()
  }

  /** Paste clipboard contents with +20 px offset, select the new nodes. */
  pasteFromClipboard(): void {
    this._objectOps!.pasteFromClipboard(this)
  }

  /** Move selected nodes to the top of their layer's z-order.
   *  Note: z-order undo is a Phase 3 item — these operations are not undoable. */
  bringToFront(): void {
    this._objectOps!.bringToFront()
  }

  /** Move selected nodes to the bottom of their layer's z-order.
   *  Note: z-order undo is a Phase 3 item — these operations are not undoable. */
  sendToBack(): void {
    this._objectOps!.sendToBack()
  }

  /**
   * Lock the currently selected nodes — they become unselectable/undraggable
   * and are deselected immediately.
   */
  lockSelected(): void {
    this._objectOps!.lockSelected()
  }

  /**
   * Unlock all locked nodes — locked nodes cannot be individually selected,
   * so this always unlocks the entire locked set.
   */
  unlockSelected(): void {
    this._objectOps!.unlockSelected()
  }

  /** Select all unlocked nodes on all visible layers in a single pass. */
  selectAll(): void {
    this._objectOps!.selectAll()
  }

  // -------------------------------------------------------------------------
  // Align & Distribute
  // -------------------------------------------------------------------------

  alignSelected(alignment: Alignment): void {
    this._objectOps!.alignSelected(alignment, this)
  }

  distributeSelected(axis: DistributeAxis): void {
    this._objectOps!.distributeSelected(axis, this)
  }

  // -------------------------------------------------------------------------
  // Group / Ungroup
  // -------------------------------------------------------------------------

  groupSelectedNodes(): void {
    this._objectOps!.groupSelectedNodes(this)
  }

  ungroupSelectedNodes(): void {
    this._objectOps!.ungroupSelectedNodes(this)
  }

  setPlantColor(plantId: string, color: string | null): boolean {
    const group = this._findPlantGroupById(plantId)
    if (!group) return false

    const nextColor = normalizeHexColor(color)
    const currentColor = normalizeHexColor(group.getAttr('data-color-override') as string | null | undefined)
    if (currentColor === nextColor) return false

    this.history.execute(new SetPlantColorCommand(plantId, currentColor, nextColor), this)
    return true
  }

  setSelectedPlantColor(color: string | null): number {
    return this._applyPlantColorToGroups(this._getSelectedPlantGroups(), color)
  }

  setPlantColorForSpecies(canonicalName: string, color: string | null): number {
    const nextColor = normalizeHexColor(color)
    const currentDefaultColor = this.getPlantSpeciesColor(canonicalName)
    const plantsLayer = this.layers.get('plants')
    const groups = plantsLayer
      ? (plantsLayer.find('.plant-group') as Konva.Group[])
          .filter((group) => (group.getAttr('data-canonical-name') as string) === canonicalName)
      : []
    const commands: Command[] = this._createPlantColorCommands(groups, nextColor)

    if (currentDefaultColor !== nextColor) {
      commands.push(new SetPlantSpeciesColorCommand(canonicalName, currentDefaultColor, nextColor))
    }
    if (commands.length === 0) return 0

    this.history.execute(commands.length === 1 ? commands[0]! : new BatchCommand(commands), this)
    return groups.length
  }

  clearPlantSpeciesColor(canonicalName: string): boolean {
    const currentDefaultColor = this.getPlantSpeciesColor(canonicalName)
    if (!currentDefaultColor) return false

    this.history.execute(new SetPlantSpeciesColorCommand(canonicalName, currentDefaultColor, null), this)
    return true
  }

  getPlantSpeciesColor(canonicalName: string): string | null {
    return normalizeHexColor(plantSpeciesColors.value[canonicalName] ?? null)
  }

  createPlantPlacementNode(plant: PlantPlacementSpec): Konva.Group {
    return createPlantNode({
      id: crypto.randomUUID(),
      canonicalName: plant.canonicalName,
      commonName: plant.commonName,
      color: this.getPlantSpeciesColor(plant.canonicalName),
      stratum: plant.stratum,
      canopySpreadM: plant.canopySpreadM,
      position: plant.position,
      stageScale: this.stage.scaleX(),
    })
  }

  private _applyPlantColorToGroups(groups: Konva.Group[], color: string | null): number {
    const commands = this._createPlantColorCommands(groups, normalizeHexColor(color))
    if (commands.length === 0) return 0
    this.history.execute(commands.length === 1 ? commands[0]! : new BatchCommand(commands), this)
    return commands.length
  }

  private _createPlantColorCommands(groups: Konva.Group[], nextColor: string | null): Command[] {
    return groups.flatMap((group) => {
      const currentColor = normalizeHexColor(group.getAttr('data-color-override') as string | null | undefined)
      if (currentColor === nextColor) return []
      return [new SetPlantColorCommand(group.id(), currentColor, nextColor)]
    })
  }

  getSelectedPlantColorContext(): SelectedPlantColorContext {
    const groups = this._getSelectedPlantGroups()
    if (groups.length === 0) {
      return {
        plantIds: [],
        singleSpeciesCanonicalName: null,
        singleSpeciesCommonName: null,
        sharedCurrentColor: null,
        suggestedColor: null,
        singleSpeciesDefaultColor: null,
      }
    }

    const plantIds = groups.map((group) => group.id())
    const canonicalNames = new Set<string>()
    const commonNames = new Set<string>()
    const currentColors = new Set<string>()
    let hasNullColor = false

    for (const group of groups) {
      const canonicalName = (group.getAttr('data-canonical-name') as string | null) ?? ''
      const commonName = (group.getAttr('data-common-name') as string | null) ?? null
      const currentColor = normalizeHexColor(group.getAttr('data-color-override') as string | null | undefined)

      if (canonicalName) canonicalNames.add(canonicalName)
      if (commonName) commonNames.add(commonName)
      if (currentColor) currentColors.add(currentColor)
      else hasNullColor = true
    }

    const singleSpeciesCanonicalName = canonicalNames.size === 1 ? [...canonicalNames][0]! : null
    const singleSpeciesCommonName =
      singleSpeciesCanonicalName !== null && commonNames.size === 1 ? [...commonNames][0]! : null
    const sharedCurrentColor =
      currentColors.size > 1 || (currentColors.size === 1 && hasNullColor)
        ? 'mixed'
        : currentColors.size === 1
          ? [...currentColors][0]!
          : null

    return {
      plantIds,
      singleSpeciesCanonicalName,
      singleSpeciesCommonName,
      sharedCurrentColor,
      suggestedColor:
        singleSpeciesCanonicalName !== null
          ? this.getSuggestedPlantColor(singleSpeciesCanonicalName)
          : null,
      singleSpeciesDefaultColor:
        singleSpeciesCanonicalName !== null
          ? this.getPlantSpeciesColor(singleSpeciesCanonicalName)
          : null,
    }
  }

  /** Load species details for thematic coloring. Call before switching to color-by mode. */
  async loadSpeciesCache(activeLocale: string): Promise<boolean> {
    return this._speciesCache.loadVisiblePlantEntries(this.layers.get('plants'), activeLocale)
  }

  async ensureSpeciesCacheEntries(
    canonicalNames: string[],
    activeLocale: string,
  ): Promise<boolean> {
    return this._speciesCache.ensureEntries(canonicalNames, activeLocale)
  }

  getSuggestedPlantColor(canonicalName: string): string | null {
    return this._speciesCache.getSuggestedPlantColor(canonicalName)
  }

  private _getPlantGroupFromNode(node: Konva.Node | null): Konva.Group | null {
    let current = node
    while (current) {
      if (current instanceof Konva.Group && current.hasName('plant-group')) {
        return current
      }
      current = current.parent
    }
    return null
  }

  private _findPlantGroupById(plantId: string): Konva.Group | null {
    const plantsLayer = this.layers.get('plants')
    if (!plantsLayer) return null
    const group = plantsLayer.findOne('#' + plantId)
    return group instanceof Konva.Group && group.hasName('plant-group') ? group : null
  }

  private _getSelectedPlantGroups(): Konva.Group[] {
    return this.getSelectedNodes().flatMap((node) => {
      const group = this._getPlantGroupFromNode(node)
      return group ? [group] : []
    })
  }

  getObjectGroups(): ObjectGroup[] {
    return this._objectOps!.getObjectGroups(this)
  }

  restoreObjectGroups(groups: ObjectGroup[]): void {
    this._objectOps!.restoreObjectGroups(groups, this)
  }

  loadDocument(file: CanopiFile): void {
    plantColorMenuOpen.value = false
    this._documentLoadEpoch += 1
    this._viewport?.resetViewport()
    loadDocumentSession(file, this)
    this._applyTool(activeTool.value)
  }

  replaceDocument(file: CanopiFile): void {
    plantColorMenuOpen.value = false
    this._documentLoadEpoch += 1
    resetTransientCanvasSession()
    this._viewport?.resetViewport()
    loadDocumentSession(file, this)
    this._applyTool(activeTool.value)
  }

  reconcileMaterializedScene(): void {
    this.invalidateRender(
      'counter-scale',
      'plant-display',
      'lod',
      'annotations',
      'theme',
      'overlays',
      'density',
      'stacking',
    )
  }

  invalidateRender(...passes: RenderPass[]): void {
    this._renderReconciler?.invalidate(...passes)
  }

  applyStageTransform(
    scale: number,
    position: { x: number; y: number },
    options: { invalidateDeferred?: boolean } = {},
  ): void {
    this._renderReconciler?.applyStageTransform(scale, position, options)
  }

  getDocumentLoadEpoch(): number {
    return this._documentLoadEpoch
  }

  // -------------------------------------------------------------------------
  // Plant serialization
  // -------------------------------------------------------------------------

  /** Collect all placed plant nodes for design file serialization. */
  getPlacedPlants(): PlacedPlant[] {
    return this._objectOps!.getPlacedPlants()
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

    this._renderReconciler?.dispose()
    this._renderReconciler = null
    this._renderPipeline?.dispose()
    this._renderPipeline = null
    this._viewport?.destroy()
    this._viewport = null

    this._externalInput?.destroy()
    this._externalInput = null

    // Deactivate current tool cleanly
    const currentTool = this.toolRegistry.get(activeTool.value)
    currentTool?.deactivate(this)

    this._htmlRulers?.destroy()
    this._htmlRulers = null

    if (this._tooltip) {
      this._tooltip.remove()
      this._tooltip = null
    }
    plantColorMenuOpen.value = false

    this.stage.destroy()
    this.layers.clear()
    this.toolRegistry.clear()
    this.history.clear()
    this._gridShape = null
    this._objectOps = null
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
