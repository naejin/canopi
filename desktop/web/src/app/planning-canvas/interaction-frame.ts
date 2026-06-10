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

export interface PlanningCanvasInteractionFrame {
  installDocumentListeners(options: PlanningCanvasDocumentListenerOptions): () => void
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
      clearHover()
      clearSelection()
    },
  }
}
