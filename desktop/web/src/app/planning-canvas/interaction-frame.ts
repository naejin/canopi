import type { PanelTarget } from '../../types/design'

interface MutableDomRef<T> {
  current: T | null
}

export interface PlanningCanvasTargetPresentation {
  setHoveredTargets(targets: readonly PanelTarget[]): void
  clearHoveredTargets(): void
  setSelectedTargets(targets: readonly PanelTarget[]): void
  clearSelectedTargets(): void
}

export interface PlanningCanvasDocumentEvents {
  handleMouseMove(event: MouseEvent): void
  handleMouseUp(event: MouseEvent): void
  handleMouseLeave(): void
  handleKeyDown(event: KeyboardEvent): void
}

export interface PlanningCanvasInteractionFrameOptions {
  getHoveredId(): string | null
  setHoveredId(id: string | null): void
  getSelectedId(): string | null
  setSelectedId(id: string | null): void
  clearLocalHover(): void
  clearLocalSelection(): void
  readonly targetPresentation: PlanningCanvasTargetPresentation
  readonly documentEvents: PlanningCanvasDocumentEvents
}

export interface PlanningCanvasDocumentListenerOptions {
  readonly canvasRef: MutableDomRef<HTMLCanvasElement>
  readonly handleWheel?: (event: WheelEvent) => void
}

export interface PlanningCanvasItemTarget {
  readonly id: string
  readonly targets: readonly PanelTarget[]
}

export type PlanningCanvasDragFinishMode = 'commit' | 'abort'

export interface PlanningCanvasActiveDragLifecycle<TDrag> {
  beforeFinish?(drag: TDrag, mode: PlanningCanvasDragFinishMode): void
  commit(drag: TDrag): void
  abort(drag: TDrag): void
  afterFinish?(drag: TDrag, mode: PlanningCanvasDragFinishMode): void
}

interface ActivePlanningCanvasDrag {
  readonly drag: unknown
  readonly lifecycle: PlanningCanvasActiveDragLifecycle<unknown>
}

export interface PlanningCanvasInteractionFrame {
  installDocumentListeners(options: PlanningCanvasDocumentListenerOptions): () => void
  beginActiveDrag<TDrag>(
    drag: TDrag,
    lifecycle: PlanningCanvasActiveDragLifecycle<TDrag>,
  ): void
  getActiveDrag<TDrag>(): TDrag | null
  finishActiveDrag<TDrag>(): TDrag | null
  abortActiveDrag<TDrag>(): TDrag | null
  setHoveredItem(item: PlanningCanvasItemTarget, applyLocalHover: () => void): void
  clearHover(): void
  setSelectedItem(item: PlanningCanvasItemTarget, applyLocalSelection: () => void): void
  clearSelection(): void
  syncVisibleItems(items: readonly { readonly id: string }[]): void
  cleanup(): void
}

export function createPlanningCanvasInteractionFrame({
  getHoveredId,
  setHoveredId,
  getSelectedId,
  setSelectedId,
  clearLocalHover,
  clearLocalSelection,
  targetPresentation,
  documentEvents,
}: PlanningCanvasInteractionFrameOptions): PlanningCanvasInteractionFrame {
  let activeDrag: ActivePlanningCanvasDrag | null = null

  const clearHover = (): void => {
    setHoveredId(null)
    clearLocalHover()
    targetPresentation.clearHoveredTargets()
  }

  const clearSelection = (): void => {
    setSelectedId(null)
    clearLocalSelection()
    targetPresentation.clearSelectedTargets()
  }

  const finishActiveDrag = (mode: PlanningCanvasDragFinishMode): unknown | null => {
    const active = activeDrag
    if (!active) return null

    const { drag, lifecycle } = active
    try {
      lifecycle.beforeFinish?.(drag, mode)
      if (mode === 'commit') {
        lifecycle.commit(drag)
      } else {
        lifecycle.abort(drag)
      }
    } finally {
      if (activeDrag === active) activeDrag = null
      lifecycle.afterFinish?.(drag, mode)
    }
    return drag
  }

  return {
    installDocumentListeners({ canvasRef, handleWheel }) {
      const canvas = canvasRef.current
      const onMove = (event: MouseEvent) => {
        documentEvents.handleMouseMove(event)
      }
      const onUp = (event: MouseEvent) => {
        documentEvents.handleMouseUp(event)
      }
      const onLeave = () => {
        documentEvents.handleMouseLeave()
      }
      const onKeyDown = (event: KeyboardEvent) => {
        documentEvents.handleKeyDown(event)
      }

      if (canvas && handleWheel) canvas.addEventListener('wheel', handleWheel, { passive: false })
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.addEventListener('keydown', onKeyDown)
      document.documentElement.addEventListener('mouseleave', onLeave)

      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        if (canvas && handleWheel) canvas.removeEventListener('wheel', handleWheel)
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.removeEventListener('keydown', onKeyDown)
        document.documentElement.removeEventListener('mouseleave', onLeave)
      }
    },

    beginActiveDrag<TDrag>(
      drag: TDrag,
      lifecycle: PlanningCanvasActiveDragLifecycle<TDrag>,
    ): void {
      activeDrag = {
        drag,
        lifecycle: lifecycle as PlanningCanvasActiveDragLifecycle<unknown>,
      }
    },

    getActiveDrag<TDrag>(): TDrag | null {
      return (activeDrag?.drag ?? null) as TDrag | null
    },

    finishActiveDrag<TDrag>(): TDrag | null {
      return finishActiveDrag('commit') as TDrag | null
    },

    abortActiveDrag<TDrag>(): TDrag | null {
      return finishActiveDrag('abort') as TDrag | null
    },

    setHoveredItem(item, applyLocalHover) {
      setHoveredId(item.id)
      targetPresentation.setHoveredTargets(item.targets)
      applyLocalHover()
    },

    clearHover,

    setSelectedItem(item, applyLocalSelection) {
      setSelectedId(item.id)
      applyLocalSelection()
      targetPresentation.setSelectedTargets(item.targets)
    },

    clearSelection,

    syncVisibleItems(items) {
      const liveIds = new Set(items.map((item) => item.id))
      const selectedId = getSelectedId()
      if (selectedId && !liveIds.has(selectedId)) clearSelection()
      const hoveredId = getHoveredId()
      if (hoveredId && !liveIds.has(hoveredId)) clearHover()
    },

    cleanup() {
      finishActiveDrag('abort')
      clearHover()
      clearSelection()
    },
  }
}
