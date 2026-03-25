import Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasEngine } from '../engine'
import { selectedObjectIds, lockedObjectIds } from '../../state/canvas'
import { computeSelectionRect, nodesInRect } from '../operations'
import { MoveNodeCommand, TransformNodeCommand, BatchCommand } from '../commands'
import type { TransformAttrs } from '../commands'
import { updateDimensionsForNode } from '../dimensions'

// Konva hex values matching the --canvas-selection CSS token (rgba(45, 95, 63, 0.15))
// and --color-primary (#2D5F3F). Raw values are required — Konva cannot read CSS vars.
const SELECTION_FILL = 'rgba(45, 95, 63, 0.15)'
const SELECTION_STROKE = 'rgba(45, 95, 63, 0.6)'
const TRANSFORMER_STROKE = '#2D5F3F'
const HOVER_SHADOW_COLOR = '#2D5F3F'
const HOVER_SHADOW_BLUR = 6
const HOVER_SHADOW_OPACITY = 0.45

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

  // Bounding rect shown when >TRANSFORMER_NODE_LIMIT nodes are selected
  private _boundingRect: Konva.Rect | null = null

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
    this._detachTransformer()
    selectedObjectIds.value = new Set()
  }

  // -------------------------------------------------------------------------
  // Mouse events
  // -------------------------------------------------------------------------

  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    // Space-pan takes over — let the engine handle it
    if (engine.stage.draggable()) return

    const target = e.target
    const isStage = target === engine.stage || target === (engine.stage as unknown as { content: unknown }).content

    if (isStage) {
      // Start rubber-band selection
      const pos = engine.stage.getRelativePointerPosition()
      if (!pos) return

      // Deselect unless shift is held
      if (!e.evt.shiftKey) {
        selectedObjectIds.value = new Set()
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
  }

  onMouseUp(_e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasEngine): void {
    // Capture and clear band state before any early returns so the rect is
    // never left stranded on the canvas regardless of what goes wrong below.
    const wasDragging = this._isDraggingBand
    const bandStart = this._bandStart
    this._isDraggingBand = false
    this._bandStart = null

    if (wasDragging && bandStart) {
      const pos = engine.stage.getRelativePointerPosition()
      if (pos) {
        // Both the rubber band and nodesInRect work in world (canvas) coords —
        // no coordinate conversion needed here.
        const rect = computeSelectionRect(bandStart, pos)

        // Only perform intersection test if the band has meaningful size
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
      borderStroke: TRANSFORMER_STROKE,
      borderStrokeWidth: 1,
      anchorStroke: TRANSFORMER_STROKE,
      anchorFill: '#FFFFFF',
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
      stroke: TRANSFORMER_STROKE,
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
      fill: SELECTION_FILL,
      stroke: SELECTION_STROKE,
      strokeWidth: 1,
      strokeScaleEnabled: false,
      listening: false,
      dash: [4, 3],
    })
    annotationsLayer.add(this._bandRect as unknown as Konva.Shape)
    annotationsLayer.batchDraw()
  }

  private _destroyBand(engine: CanvasEngine): void {
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
        engine.history.record(cmds[0]!)
      } else {
        engine.history.record(new BatchCommand(cmds))
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
        engine.history.record(cmds[0]!)
      } else {
        engine.history.record(new BatchCommand(cmds))
      }

      // Update attached dimensions for all transformed nodes
      for (const node of this._transformer!.nodes()) {
        updateDimensionsForNode(node.id(), engine.layers, engine.stage.scaleX())
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

      // Apply shadow highlight to the selectable ancestor (not the child)
      if (this._hoveredNode !== node) {
        this._clearHoverState()
        this._hoveredNode = node
        node.setAttrs({
          shadowColor: HOVER_SHADOW_COLOR,
          shadowBlur: HOVER_SHADOW_BLUR,
          shadowOpacity: HOVER_SHADOW_OPACITY,
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
      this._hoveredNode.setAttrs({
        shadowColor: undefined,
        shadowBlur: 0,
        shadowOpacity: 0,
      })
      this._hoveredNode.getLayer()?.batchDraw()
      this._hoveredNode = null
    }
  }
}
