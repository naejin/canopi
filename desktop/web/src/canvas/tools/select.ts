import Konva from 'konva'
import type { CanvasTool } from './base'
import type { CanvasToolEngine } from '../contracts'
import { selectedObjectIds, lockedObjectIds } from '../../state/canvas'
import { computeSelectionRect, nodesInRect } from '../operations'
import { MoveNodeCommand, BatchCommand } from '../commands'
import { getCanvasColor, highlightTargetFor } from '../theme-refresh'

// Hover highlight — uses the theme-aware highlight-glow color so it works
// in both light and dark themes. Read at event time via getCanvasColor().
const HOVER_SHADOW_BLUR = 10
const HOVER_SHADOW_OPACITY = 0.7

export class SelectTool implements CanvasTool {
  readonly name = 'select'
  readonly cursor = 'default'

  // Rubber-band state
  private _isDraggingBand = false
  private _bandStart: { x: number; y: number } | null = null
  private _bandRect: Konva.Rect | null = null
  private _bandRafId: number | null = null

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

  // Drag tracking: map from node id → position + node ref captured at dragstart
  private _dragStartPositions: Map<string, { x: number; y: number; node: Konva.Node }> = new Map()
  private _activeDragTargetId: string | null = null

  // Bound drag handlers stored for cleanup
  private _boundDragStart: ((e: Konva.KonvaEventObject<MouseEvent>) => void) | null = null
  private _boundDragMove: ((e: Konva.KonvaEventObject<MouseEvent>) => void) | null = null
  private _boundDragEnd: ((e: Konva.KonvaEventObject<MouseEvent>) => void) | null = null

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  activate(engine: CanvasToolEngine): void {
    this._attachHoverListeners(engine)
    this._attachDragListeners(engine)
  }

  deactivate(engine: CanvasToolEngine): void {
    this._clearHoverState()
    this._detachHoverListeners(engine)
    this._detachDragListeners(engine)
    this._destroyBand(engine)
    this._clearAllHighlights(engine)
    selectedObjectIds.value = new Set()
  }

  // -------------------------------------------------------------------------
  // Mouse events
  // -------------------------------------------------------------------------

  onMouseDown(e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasToolEngine): void {
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

      // Deselect unless an additive selection modifier is held.
      if (!this._hasAdditiveModifier(e.evt)) {
        selectedObjectIds.value = new Set()
        this._syncSelectionHighlights(engine)
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
    const selectable = this._findSelectableAncestor(target, engine.stage)
    if (!selectable) return

    const id = selectable.id()
    if (!id) return

    // Don't select locked nodes
    if (lockedObjectIds.value.has(id)) return

    const toggleSelection = this._hasAdditiveModifier(e.evt)
    const currentIds = new Set(selectedObjectIds.value)

    if (toggleSelection) {
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
    this._syncSelectionHighlights(engine)
  }

  onMouseMove(_e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasToolEngine): void {
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

      // Single redraw after all highlight changes
      this._redrawHighlightedLayers(engine)
    })
  }

  onMouseUp(_e: Konva.KonvaEventObject<MouseEvent>, engine: CanvasToolEngine): void {
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
          this._syncSelectionHighlights(engine)
        }
      }
    }

    // Always destroy the band rect — even if selection logic was skipped.
    this._destroyBand(engine)
  }

  // -------------------------------------------------------------------------
  // Rubber-band rectangle
  // -------------------------------------------------------------------------

  private _createBand(engine: CanvasToolEngine, pos: { x: number; y: number }): void {
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

  private _destroyBand(engine: CanvasToolEngine): void {
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

  private _attachDragListeners(engine: CanvasToolEngine): void {
    this._boundDragStart = (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.target === engine.stage) return

      const target = this._findSelectableAncestor(e.target, engine.stage)
      if (!target) return

      const id = target.id()
      if (!id) return

      // Capture start positions for all currently selected nodes (multi-drag)
      const ids = selectedObjectIds.value
      if (ids.has(id)) {
        // Multi-select drag: capture all selected nodes with their refs
        this._dragStartPositions.clear()
        this._activeDragTargetId = id
        for (const layer of engine.layers.values()) {
          layer.find('.shape').forEach((node) => {
            if (ids.has(node.id())) {
              this._dragStartPositions.set(node.id(), { x: node.x(), y: node.y(), node })
            }
          })
        }
      } else {
        // Single node not yet in selection
        this._dragStartPositions.clear()
        this._activeDragTargetId = id
        this._dragStartPositions.set(id, { x: target.x(), y: target.y(), node: target })
      }
    }

    this._boundDragMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.target === engine.stage) return
      if (this._dragStartPositions.size <= 1 || !this._activeDragTargetId) return

      const anchor = this._dragStartPositions.get(this._activeDragTargetId)
      if (!anchor) return

      const dx = anchor.node.x() - anchor.x
      const dy = anchor.node.y() - anchor.y
      const dirtyLayers = new Set<Konva.Layer>()

      for (const [id, start] of this._dragStartPositions) {
        if (id === this._activeDragTargetId) continue
        start.node.position({ x: start.x + dx, y: start.y + dy })
        const nodeLayer = start.node.getLayer()
        if (nodeLayer) dirtyLayers.add(nodeLayer)
      }

      for (const layer of dirtyLayers) {
        layer.batchDraw()
      }
    }

    this._boundDragEnd = (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.target === engine.stage) return
      if (this._dragStartPositions.size === 0) return

      const target = this._findSelectableAncestor(e.target, engine.stage)
      if (!target) {
        this._dragStartPositions.clear()
        this._activeDragTargetId = null
        return
      }

      const cmds: MoveNodeCommand[] = []

      for (const [id, start] of this._dragStartPositions) {
        const to = { x: start.node.x(), y: start.node.y() }
        if (start.x !== to.x || start.y !== to.y) {
          cmds.push(new MoveNodeCommand(id, { x: start.x, y: start.y }, to))
        }
      }

      this._dragStartPositions.clear()
      this._activeDragTargetId = null

      if (cmds.length === 0) return

      // Use record() — the drag already happened, we just need to log it
      if (cmds.length === 1) {
        engine.history.record(cmds[0]!, engine)
      } else {
        engine.history.record(new BatchCommand(cmds), engine)
      }
    }

    engine.stage.on('dragstart', this._boundDragStart)
    engine.stage.on('dragmove', this._boundDragMove)
    engine.stage.on('dragend', this._boundDragEnd)
  }

  private _detachDragListeners(engine: CanvasToolEngine): void {
    if (this._boundDragStart) {
      engine.stage.off('dragstart', this._boundDragStart)
      this._boundDragStart = null
    }
    if (this._boundDragMove) {
      engine.stage.off('dragmove', this._boundDragMove)
      this._boundDragMove = null
    }
    if (this._boundDragEnd) {
      engine.stage.off('dragend', this._boundDragEnd)
      this._boundDragEnd = null
    }
    this._dragStartPositions.clear()
    this._activeDragTargetId = null
  }

  // -------------------------------------------------------------------------
  // Hover effects
  // -------------------------------------------------------------------------

  private _attachHoverListeners(engine: CanvasToolEngine): void {
    this._boundMouseover = (e: Konva.KonvaEventObject<MouseEvent>) => {
      const node = this._findSelectableAncestor(e.target, engine.stage)
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
        const target = highlightTargetFor(node)
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

  private _detachHoverListeners(engine: CanvasToolEngine): void {
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
      const hoveredNode = this._hoveredNode
      if (this._selectedHighlightIds.has(hoveredNode.id())) {
        this._applyHighlight(hoveredNode)
      } else {
        const target = highlightTargetFor(hoveredNode)
        target.setAttrs({
          shadowColor: undefined,
          shadowBlur: 0,
          shadowOpacity: 0,
          shadowForStrokeEnabled: undefined,
        })
      }
      hoveredNode.getLayer()?.batchDraw()
      this._hoveredNode = null
    }
  }

  // -------------------------------------------------------------------------
  // Selection highlights — visual feedback for selected/about-to-be-selected
  // -------------------------------------------------------------------------

  /** Apply selection highlight to a node — visible ochre glow on all shape types. */
  private _applyHighlight(node: Konva.Node): void {
    const target = highlightTargetFor(node)
    const color = getCanvasColor('highlight-glow')
    // Mark the selectable node (not the child) so cleanup can find it by id
    node.setAttr('data-highlight', true)
    target.setAttrs({
      shadowColor: color,
      shadowBlur: 14,
      shadowOpacity: 0.85,
      shadowForStrokeEnabled: false,
    })
  }

  /** Remove selection highlight from a node (no redraw — caller must batch). */
  private _removeHighlightFromNode(node: Konva.Node): void {
    if (!node.getAttr('data-highlight')) return
    const target = highlightTargetFor(node)
    node.setAttr('data-highlight', undefined)
    target.setAttrs({
      shadowColor: undefined,
      shadowBlur: 0,
      shadowOpacity: 0,
      shadowForStrokeEnabled: undefined,
    })
  }

  /** Flush all dirty layers that contain highlighted nodes. */
  private _redrawHighlightedLayers(engine: CanvasToolEngine): void {
    for (const layer of engine.layers.values()) {
      layer.batchDraw()
    }
  }

  /** Remove highlight from a node by ID (finds it across layers). */
  private _removeHighlight(engine: CanvasToolEngine, id: string): void {
    for (const layer of engine.layers.values()) {
      const node = layer.findOne('#' + id)
      if (node) {
        this._removeHighlightFromNode(node)
        return
      }
    }
  }

  /** Clear all preview highlights (during rubber-band drag). */
  private _clearPreviewHighlights(engine: CanvasToolEngine): void {
    for (const id of this._previewHighlightIds) {
      this._removeHighlight(engine, id)
    }
    this._previewHighlightIds.clear()
    this._redrawHighlightedLayers(engine)
  }

  /** Sync persistent selection highlights to match selectedObjectIds. */
  private _syncSelectionHighlights(engine: CanvasToolEngine): void {
    const ids = selectedObjectIds.value

    for (const id of this._selectedHighlightIds) {
      if (!ids.has(id)) {
        this._removeHighlight(engine, id)
        this._selectedHighlightIds.delete(id)
      }
    }

    for (const layer of engine.layers.values()) {
      layer.find('.shape').forEach((node) => {
        const id = node.id()
        if (ids.has(id) && !this._selectedHighlightIds.has(id)) {
          this._applyHighlight(node)
          this._selectedHighlightIds.add(id)
        }
      })
    }

    this._redrawHighlightedLayers(engine)
  }

  /** Clear all highlights (preview + persistent). */
  private _clearAllHighlights(engine: CanvasToolEngine): void {
    this._clearPreviewHighlights(engine)
    for (const id of this._selectedHighlightIds) {
      this._removeHighlight(engine, id)
    }
    this._selectedHighlightIds.clear()
    this._redrawHighlightedLayers(engine)
  }

  private _hasAdditiveModifier(event: MouseEvent): boolean {
    return event.shiftKey || event.ctrlKey || event.metaKey
  }

  /** Walk up the Konva tree from `start` to find the nearest selectable ancestor (has id + name 'shape'). */
  private _findSelectableAncestor(start: Konva.Node, stage: Konva.Stage): Konva.Node | null {
    let node: Konva.Node | null = start
    while (node && (!node.id() || !node.hasName('shape'))) {
      node = node.getParent() as Konva.Node | null
      if (!node || node === stage || node.getClassName() === 'Layer') return null
    }
    return node
  }
}
