import Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasEngine } from '../engine'
import { selectedObjectIds, lockedObjectIds } from '../../state/canvas'
import { computeSelectionRect, nodesInRect } from '../operations'
import { MoveNodeCommand, TransformNodeCommand, BatchCommand } from '../commands'
import type { TransformAttrs } from '../commands'
import { getCanvasColor } from '../theme-refresh'

// Hover highlight — uses the theme-aware highlight-glow color so it works
// in both light and dark themes. Read at event time via getCanvasColor().
const HOVER_SHADOW_BLUR = 10
const HOVER_SHADOW_OPACITY = 0.7

// Rotation snaps every 15 degrees — full 360
const ROTATION_SNAPS = [
  0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165,
  180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345,
]

// Beyond this many selected nodes the Transformer is replaced by a plain
// bounding-rect so Konva doesn't stall computing 51+ anchor positions.
const TRANSFORMER_NODE_LIMIT = 50

export class SelectTool implements CanvasTool {
  readonly name = 'select'
  readonly cursor = 'default'

  // Single shared Transformer instance — reused across selections
  private _transformer: Konva.Transformer | null = null

  // Rubber-band state
  private _isDraggingBand = false
  private _bandStart: { x: number; y: number } | null = null
  private _bandRect: Konva.Rect | null = null
  private _bandRafId: number | null = null

  // Bounding rect shown when >TRANSFORMER_NODE_LIMIT nodes are selected
  private _boundingRect: Konva.Rect | null = null

  // Selection highlight: nodes with an active selection outline.
  // _previewHighlightIds tracks nodes highlighted during rubber-band drag (ephemeral).
  // _selectedHighlightIds tracks nodes highlighted after selection is committed (persistent).
  private _previewHighlightIds: Set<string> = new Set()
  private _selectedHighlightIds: Set<string> = new Set()

  // Track the last hovered node to restore its style on mouseout
  private _hoveredNode: Konva.Node | null = null

  // Bound event handlers stored so they can be removed on deactivate
  private _boundMouseover: ((e: Konva.KonvaEventObject<MouseEvent>) => void) | null = null
  private _boundMouseout: ((e: Konva.KonvaEventObject<MouseEvent>) => void) | null = null

  // Drag tracking: map from node id → position captured at dragstart
  private _dragStartPositions: Map<string, { x: number; y: number }> = new Map()

  // Transform tracking: map from node id → attrs captured at transformstart
  private _transformStartAttrs: Map<string, TransformAttrs> = new Map()

  // Bound drag/transform handlers stored for cleanup
  private _boundDragStart: ((e: Konva.KonvaEventObject<MouseEvent>) => void) | null = null
  private _boundDragEnd: ((e: Konva.KonvaEventObject<MouseEvent>) => void) | null = null
  private _boundTransformStart: (() => void) | null = null
  private _boundTransformEnd: (() => void) | null = null

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  activate(engine: CanvasEngine): void {
    this._ensureTransformer(engine)
    this._attachHoverListeners(engine)
    this._attachDragListeners(engine)
    this._attachTransformListeners(engine)
  }

  deactivate(engine: CanvasEngine): void {
    this._clearHoverState()
    this._detachHoverListeners(engine)
    this._detachDragListeners(engine)
    this._detachTransformListeners(engine)
    this._destroyBand(engine)
    this._destroyBoundingRect(engine)
    this._clearAllHighlights(engine)
    this._detachTransformer()
    selectedObjectIds.value = new Set()
  }

  // -------------------------------------------------------------------------
  // Mouse events
  // -------------------------------------------------------------------------

  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    // Space-pan takes over — let the engine handle it
    if (engine.stage.draggable()) return

    // Cancel any in-progress band first — handles the case where mouseup
    // was lost (e.g. pointer left canvas and clicked elsewhere).
    if (this._isDraggingBand) {
      this._isDraggingBand = false
      this._bandStart = null
      this._destroyBand(engine)
    }

    const target = e.target
    const isStage = target === engine.stage || target === (engine.stage as unknown as { content: unknown }).content

    if (isStage) {
      // Start rubber-band selection
      const pos = engine.stage.getRelativePointerPosition()
      if (!pos) return

      // Deselect unless shift is held
      if (!e.evt.shiftKey) {
        selectedObjectIds.value = new Set()
        this._syncSelectionHighlights(engine)
        this._detachTransformer()
      }

      this._isDraggingBand = true
      this._bandStart = pos
      this._createBand(engine, pos)
      return
    }

    // Walk up from the click target to find the nearest selectable ancestor
    // (a node with an id and name 'shape'). This is needed because clicking
    // a child of a Group (e.g. a plant circle inside a plant-group) gives us
    // the child as target, not the group itself.
    let selectable: Konva.Node | null = target
    while (selectable && (!selectable.id() || !selectable.hasName('shape'))) {
      selectable = selectable.getParent() as Konva.Node | null
      // Stop if we've walked up to the stage or layer level
      if (!selectable || selectable === engine.stage || selectable.getClassName() === 'Layer') {
        selectable = null
        break
      }
    }
    if (!selectable) return

    const id = selectable.id()
    if (!id) return

    // Don't select locked nodes
    if (lockedObjectIds.value.has(id)) return

    const shift = e.evt.shiftKey
    const currentIds = new Set(selectedObjectIds.value)

    if (shift) {
      // Toggle membership
      if (currentIds.has(id)) {
        currentIds.delete(id)
      } else {
        currentIds.add(id)
      }
    } else {
      // Single selection — only clear and re-select if not already in selection
      if (!currentIds.has(id)) {
        currentIds.clear()
        currentIds.add(id)
      }
    }

    selectedObjectIds.value = currentIds
    this._syncTransformer(engine)
  }

  onMouseMove(_e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    if (!this._isDraggingBand || !this._bandStart || !this._bandRect) return

    const pos = engine.stage.getRelativePointerPosition()
    if (!pos) return

    const rect = computeSelectionRect(this._bandStart, pos)
    this._bandRect.setAttrs(rect)
    this._bandRect.getLayer()?.batchDraw()

    // Throttle intersection test to rAF — nodesInRect walks all layers.
    // Capture rect now so the rAF callback uses the position from this frame,
    // not a stale re-read (getRelativePointerPosition is a one-shot override
    // when the cursor is outside the canvas).
    if (this._bandRafId !== null) return
    const bandRect = rect
    this._bandRafId = requestAnimationFrame(() => {
      this._bandRafId = null
      if (!this._isDraggingBand) return
      if (bandRect.width < 2 || bandRect.height < 2) return

      const found = nodesInRect(engine, bandRect, lockedObjectIds.value)
      const foundIds = new Set(found.map((n) => n.id()))

      // Remove highlights from nodes no longer in the band
      for (const id of this._previewHighlightIds) {
        if (!foundIds.has(id)) {
          this._removeHighlight(engine, id)
          this._previewHighlightIds.delete(id)
        }
      }

      // Add highlights to newly intersecting nodes
      for (const node of found) {
        const id = node.id()
        if (!this._previewHighlightIds.has(id)) {
          this._applyHighlight(node)
          this._previewHighlightIds.add(id)
        }
      }
    })
  }

  onMouseUp(_e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    // Capture and clear band state before any early returns so the rect is
    // never left stranded on the canvas regardless of what goes wrong below.
    const wasDragging = this._isDraggingBand
    const bandStart = this._bandStart
    this._isDraggingBand = false
    this._bandStart = null

    // Clear preview highlights — they'll be replaced by persistent selection highlights
    this._clearPreviewHighlights(engine)

    if (wasDragging && bandStart) {
      const pos = engine.stage.getRelativePointerPosition()
      if (pos) {
        const rect = computeSelectionRect(bandStart, pos)

        if (rect.width > 2 && rect.height > 2) {
          const found = nodesInRect(engine, rect, lockedObjectIds.value)
          const newIds = new Set(selectedObjectIds.value)
          for (const node of found) {
            newIds.add(node.id())
          }
          selectedObjectIds.value = newIds
          this._syncTransformer(engine)
        }
      }
    }

    // Always destroy the band rect — even if selection logic was skipped.
    this._destroyBand(engine)
  }

  // -------------------------------------------------------------------------
  // Transformer management
  // -------------------------------------------------------------------------

  private _ensureTransformer(_engine: CanvasEngine): void {
    if (this._transformer) return

    // Don't add to any layer yet — it will be added to the same layer
    // as the selected nodes in _syncTransformer. Konva requires the
    // Transformer to be on the same layer as its target nodes.
    this._transformer = new Konva.Transformer({
      rotationSnaps: ROTATION_SNAPS,
      keepRatio: true,
      borderStroke: getCanvasColor('selection-stroke'),
      borderStrokeWidth: 1,
      anchorStroke: getCanvasColor('selection-stroke'),
      anchorFill: getCanvasColor('selection-anchor-fill'),
      anchorSize: 8,
      anchorCornerRadius: 2,
      rotateEnabled: true,
      enabledAnchors: [
        'top-left', 'top-center', 'top-right',
        'middle-right', 'middle-left',
        'bottom-left', 'bottom-center', 'bottom-right',
      ],
    })
  }

  private _detachTransformer(): void {
    if (this._transformer) {
      this._transformer.nodes([])
      this._transformer.getLayer()?.batchDraw()
    }
  }

  private _syncTransformer(engine: CanvasEngine): void {
    this._ensureTransformer(engine)
    this._destroyBoundingRect(engine)

    // Sync persistent selection highlights: remove stale, add new
    this._syncSelectionHighlights(engine)

    const ids = selectedObjectIds.value
    if (ids.size === 0) {
      this._detachTransformer()
      return
    }

    // Collect nodes in one pass
    const nodes: Konva.Node[] = []
    for (const layer of engine.layers.values()) {
      layer.find('.shape').forEach((node) => {
        if (ids.has(node.id())) nodes.push(node)
      })
    }

    if (nodes.length === 0) {
      this._detachTransformer()
      return
    }

    if (nodes.length > TRANSFORMER_NODE_LIMIT) {
      this._detachTransformer()
      this._showBoundingRect(engine, nodes)
      return
    }

    // Move the Transformer to the SAME layer as the first selected node.
    // Konva requires Transformer and its targets on the same layer for
    // proper drag/transform coordination.
    const targetLayer = nodes[0]!.getLayer()
    const currentLayer = this._transformer!.getLayer()
    if (targetLayer && targetLayer !== currentLayer) {
      this._transformer!.remove()
      targetLayer.add(this._transformer! as unknown as Konva.Shape)
    }

    this._transformer!.nodes(nodes)
    this._transformer!.getLayer()?.batchDraw()
  }

  // -------------------------------------------------------------------------
  // Bounding rect (fallback for >50 selected nodes)
  // -------------------------------------------------------------------------

  private _showBoundingRect(engine: CanvasEngine, nodes: Konva.Node[]): void {
    const annotationsLayer = engine.layers.get('annotations')
    if (!annotationsLayer) return

    // Compute union bounding box in screen (client) coordinates, then convert
    // to world (canvas) coordinates to handle any zoom/pan correctly.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    const scale = engine.stage.scaleX()
    const stagePos = engine.stage.position()

    for (const node of nodes) {
      // getClientRect() with no argument returns screen-space coordinates
      const r = node.getClientRect()
      minX = Math.min(minX, r.x)
      minY = Math.min(minY, r.y)
      maxX = Math.max(maxX, r.x + r.width)
      maxY = Math.max(maxY, r.y + r.height)
    }

    // Convert screen-space bbox to world (canvas) coordinates
    const x = (minX - stagePos.x) / scale
    const y = (minY - stagePos.y) / scale
    const width = (maxX - minX) / scale
    const height = (maxY - minY) / scale

    this._boundingRect = new Konva.Rect({
      x, y, width, height,
      stroke: getCanvasColor('selection-stroke'),
      strokeWidth: 1,
      strokeScaleEnabled: false,
      dash: [6, 3],
      fill: 'transparent',
      listening: false,
    })
    annotationsLayer.add(this._boundingRect as unknown as Konva.Shape)
    annotationsLayer.batchDraw()
  }

  private _destroyBoundingRect(engine: CanvasEngine): void {
    if (this._boundingRect) {
      this._boundingRect.destroy()
      this._boundingRect = null
      engine.layers.get('annotations')?.batchDraw()
    }
  }

  // -------------------------------------------------------------------------
  // Rubber-band rectangle
  // -------------------------------------------------------------------------

  private _createBand(engine: CanvasEngine, pos: { x: number; y: number }): void {
    const annotationsLayer = engine.layers.get('annotations')
    if (!annotationsLayer) return

    this._bandRect = new Konva.Rect({
      x: pos.x,
      y: pos.y,
      width: 0,
      height: 0,
      fill: getCanvasColor('selection-fill'),
      stroke: getCanvasColor('selection-stroke'),
      strokeWidth: 1,
      strokeScaleEnabled: false,
      listening: false,
      dash: [4, 3],
    })
    annotationsLayer.add(this._bandRect as unknown as Konva.Shape)
    annotationsLayer.batchDraw()
  }

  private _destroyBand(engine: CanvasEngine): void {
    if (this._bandRafId !== null) {
      cancelAnimationFrame(this._bandRafId)
      this._bandRafId = null
    }
    if (this._bandRect) {
      this._bandRect.destroy()
      this._bandRect = null
      engine.layers.get('annotations')?.batchDraw()
    }
  }

  // -------------------------------------------------------------------------
  // Drag tracking (for undo)
  // -------------------------------------------------------------------------

  private _captureTransformAttrs(node: Konva.Node): TransformAttrs {
    return {
      x: node.x(),
      y: node.y(),
      scaleX: node.scaleX(),
      scaleY: node.scaleY(),
      rotation: node.rotation(),
      width: (node as Konva.Rect).width?.() ?? undefined,
      height: (node as Konva.Rect).height?.() ?? undefined,
    }
  }

  private _attachDragListeners(engine: CanvasEngine): void {
    this._boundDragStart = (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.target === engine.stage) return

      // Walk up to find the selectable ancestor (same as onMouseDown)
      let target: Konva.Node | null = e.target
      while (target && (!target.id() || !target.hasName('shape'))) {
        target = target.getParent() as Konva.Node | null
        if (!target || target === engine.stage || target.getClassName() === 'Layer') {
          target = null
          break
        }
      }
      if (!target) return

      const id = target.id()
      if (!id) return

      // Capture start positions for all currently selected nodes (multi-drag)
      const ids = selectedObjectIds.value
      if (ids.has(id)) {
        // Multi-select drag: capture all selected nodes
        this._dragStartPositions.clear()
        for (const layer of engine.layers.values()) {
          layer.find('.shape').forEach((node) => {
            if (ids.has(node.id())) {
              this._dragStartPositions.set(node.id(), { x: node.x(), y: node.y() })
            }
          })
        }
      } else {
        // Single node not yet in selection
        this._dragStartPositions.clear()
        this._dragStartPositions.set(id, { x: target.x(), y: target.y() })
      }
    }

    this._boundDragEnd = (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.target === engine.stage) return
      if (this._dragStartPositions.size === 0) return

      // Walk up to selectable ancestor (consistent with dragstart)
      let target: Konva.Node | null = e.target
      while (target && (!target.id() || !target.hasName('shape'))) {
        target = target.getParent() as Konva.Node | null
        if (!target || target === engine.stage || target.getClassName() === 'Layer') {
          target = null
          break
        }
      }
      if (!target) { this._dragStartPositions.clear(); return }

      const cmds: MoveNodeCommand[] = []

      if (this._dragStartPositions.size === 1) {
        const id = target.id()
        const from = this._dragStartPositions.get(id)
        if (from) {
          const to = { x: target.x(), y: target.y() }
          // Only record if position actually changed
          if (from.x !== to.x || from.y !== to.y) {
            cmds.push(new MoveNodeCommand(id, from, to))
          }
        }
      } else {
        // Multi-drag: find each node's new position
        for (const layer of engine.layers.values()) {
          layer.find('.shape').forEach((node) => {
            const from = this._dragStartPositions.get(node.id())
            if (from) {
              const to = { x: node.x(), y: node.y() }
              if (from.x !== to.x || from.y !== to.y) {
                cmds.push(new MoveNodeCommand(node.id(), from, to))
              }
            }
          })
        }
      }

      this._dragStartPositions.clear()

      if (cmds.length === 0) return

      // Use record() — the drag already happened, we just need to log it
      if (cmds.length === 1) {
        engine.history.record(cmds[0]!, engine)
      } else {
        engine.history.record(new BatchCommand(cmds), engine)
      }
    }

    engine.stage.on('dragstart', this._boundDragStart)
    engine.stage.on('dragend', this._boundDragEnd)
  }

  private _detachDragListeners(engine: CanvasEngine): void {
    if (this._boundDragStart) {
      engine.stage.off('dragstart', this._boundDragStart)
      this._boundDragStart = null
    }
    if (this._boundDragEnd) {
      engine.stage.off('dragend', this._boundDragEnd)
      this._boundDragEnd = null
    }
    this._dragStartPositions.clear()
  }

  // -------------------------------------------------------------------------
  // Transform tracking (for undo)
  // -------------------------------------------------------------------------

  private _attachTransformListeners(engine: CanvasEngine): void {
    this._boundTransformStart = () => {
      if (!this._transformer) return
      this._transformStartAttrs.clear()
      for (const node of this._transformer.nodes()) {
        this._transformStartAttrs.set(node.id(), this._captureTransformAttrs(node))
      }
    }

    this._boundTransformEnd = () => {
      if (!this._transformer) return
      const cmds: TransformNodeCommand[] = []

      for (const node of this._transformer.nodes()) {
        const oldAttrs = this._transformStartAttrs.get(node.id())
        if (!oldAttrs) continue
        const newAttrs = this._captureTransformAttrs(node)
        cmds.push(new TransformNodeCommand(node.id(), oldAttrs, newAttrs))
      }

      this._transformStartAttrs.clear()

      if (cmds.length === 0) return

      // Use record() — the transform already happened
      if (cmds.length === 1) {
        engine.history.record(cmds[0]!, engine)
      } else {
        engine.history.record(new BatchCommand(cmds), engine)
      }

    }

    // Transformer fires events on itself, not the stage
    // We wire these after the transformer is guaranteed to exist.
    // Re-wiring happens lazily in _syncTransformer when we first have nodes.
    this._wireTransformerEvents()
  }

  private _wireTransformerEvents(): void {
    if (!this._transformer) return
    if (this._boundTransformStart) {
      this._transformer.on('transformstart', this._boundTransformStart)
    }
    if (this._boundTransformEnd) {
      this._transformer.on('transformend', this._boundTransformEnd)
    }
  }

  private _detachTransformListeners(_engine: CanvasEngine): void {
    if (this._transformer) {
      if (this._boundTransformStart) {
        this._transformer.off('transformstart', this._boundTransformStart)
      }
      if (this._boundTransformEnd) {
        this._transformer.off('transformend', this._boundTransformEnd)
      }
    }
    this._boundTransformStart = null
    this._boundTransformEnd = null
    this._transformStartAttrs.clear()
  }

  // -------------------------------------------------------------------------
  // Hover effects
  // -------------------------------------------------------------------------

  private _attachHoverListeners(engine: CanvasEngine): void {
    this._boundMouseover = (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Walk up from hover target to find a selectable shape (has id + name 'shape')
      let node: Konva.Node | null = e.target
      while (node && (!node.id() || !node.hasName('shape'))) {
        node = node.getParent() as Konva.Node | null
        if (!node || node === engine.stage || node.getClassName() === 'Layer') {
          node = null
          break
        }
      }
      if (!node) return

      const id = node.id()

      // No hover feedback on locked nodes
      if (lockedObjectIds.value.has(id)) {
        const container = engine.stage.container()
        if (container) container.style.cursor = 'not-allowed'
        return
      }

      // Update cursor based on selection state
      const container = engine.stage.container()
      if (container) {
        container.style.cursor = selectedObjectIds.value.has(id) ? 'move' : 'pointer'
      }

      // Apply hover shadow to the visual target (child for plant groups)
      if (this._hoveredNode !== node) {
        this._clearHoverState()
        this._hoveredNode = node
        const target = this._highlightTarget(node)
        target.setAttrs({
          shadowColor: getCanvasColor('highlight-glow'),
          shadowBlur: HOVER_SHADOW_BLUR,
          shadowOpacity: HOVER_SHADOW_OPACITY,
          shadowForStrokeEnabled: false,
        })
        node.getLayer()?.batchDraw()
      }
    }

    this._boundMouseout = (_e: Konva.KonvaEventObject<MouseEvent>) => {
      const container = engine.stage.container()
      if (container) container.style.cursor = 'default'
      this._clearHoverState()
    }

    engine.stage.on('mouseover', this._boundMouseover)
    engine.stage.on('mouseout', this._boundMouseout)
  }

  private _detachHoverListeners(engine: CanvasEngine): void {
    if (this._boundMouseover) {
      engine.stage.off('mouseover', this._boundMouseover)
      this._boundMouseover = null
    }
    if (this._boundMouseout) {
      engine.stage.off('mouseout', this._boundMouseout)
      this._boundMouseout = null
    }
  }

  private _clearHoverState(): void {
    if (this._hoveredNode) {
      const target = this._highlightTarget(this._hoveredNode)
      target.setAttrs({
        shadowColor: undefined,
        shadowBlur: 0,
        shadowOpacity: 0,
        shadowForStrokeEnabled: undefined,
      })
      this._hoveredNode.getLayer()?.batchDraw()
      this._hoveredNode = null
    }
  }

  // -------------------------------------------------------------------------
  // Selection highlights — visual feedback for selected/about-to-be-selected
  // -------------------------------------------------------------------------

  /**
   * Get the node to apply visual highlight effects to. For counter-scaled
   * groups (plant groups), returns the first child so the shadow renders in
   * screen-pixel space and stays visible at any zoom level.
   */
  private _highlightTarget(node: Konva.Node): Konva.Node {
    if (node instanceof Konva.Group && node.hasName('plant-group')) {
      const child = (node as Konva.Group).getChildren()[0]
      if (child) return child
    }
    return node
  }

  /** Apply selection highlight to a node — visible ochre glow on all shape types. */
  private _applyHighlight(node: Konva.Node): void {
    const target = this._highlightTarget(node)
    const color = getCanvasColor('highlight-glow')
    // Mark the selectable node (not the child) so cleanup can find it by id
    node.setAttr('data-highlight', true)
    target.setAttrs({
      shadowColor: color,
      shadowBlur: 14,
      shadowOpacity: 0.85,
      shadowForStrokeEnabled: false,
    })
    node.getLayer()?.batchDraw()
  }

  /** Remove selection highlight from a node. */
  private _removeHighlightFromNode(node: Konva.Node): void {
    if (!node.getAttr('data-highlight')) return
    const target = this._highlightTarget(node)
    node.setAttr('data-highlight', undefined)
    target.setAttrs({
      shadowColor: undefined,
      shadowBlur: 0,
      shadowOpacity: 0,
      shadowForStrokeEnabled: undefined,
    })
    node.getLayer()?.batchDraw()
  }

  /** Remove highlight from a node by ID (finds it across layers). */
  private _removeHighlight(engine: CanvasEngine, id: string): void {
    for (const layer of engine.layers.values()) {
      const node = layer.findOne('#' + id)
      if (node) {
        this._removeHighlightFromNode(node)
        return
      }
    }
  }

  /** Clear all preview highlights (during rubber-band drag). */
  private _clearPreviewHighlights(engine: CanvasEngine): void {
    for (const id of this._previewHighlightIds) {
      this._removeHighlight(engine, id)
    }
    this._previewHighlightIds.clear()
  }

  /** Sync persistent selection highlights to match selectedObjectIds. */
  private _syncSelectionHighlights(engine: CanvasEngine): void {
    const ids = selectedObjectIds.value

    // Remove highlights from nodes no longer selected
    for (const id of this._selectedHighlightIds) {
      if (!ids.has(id)) {
        this._removeHighlight(engine, id)
        this._selectedHighlightIds.delete(id)
      }
    }

    // Add highlights to newly selected nodes
    for (const layer of engine.layers.values()) {
      layer.find('.shape').forEach((node) => {
        const id = node.id()
        if (ids.has(id) && !this._selectedHighlightIds.has(id)) {
          this._applyHighlight(node)
          this._selectedHighlightIds.add(id)
        }
      })
    }
  }

  /** Clear all highlights (preview + persistent). */
  private _clearAllHighlights(engine: CanvasEngine): void {
    this._clearPreviewHighlights(engine)
    for (const id of this._selectedHighlightIds) {
      this._removeHighlight(engine, id)
    }
    this._selectedHighlightIds.clear()
  }
}
