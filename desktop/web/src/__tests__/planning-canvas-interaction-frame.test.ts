import { describe, expect, it, vi } from 'vitest'
import { createPlanningCanvasInteractionFrame } from '../app/planning-canvas/interaction-frame'

describe('Planning Canvas interaction frame', () => {
  it('owns active drag commit ordering behind the frame seam', () => {
    const events: string[] = []
    const frame = createPlanningCanvasInteractionFrame({
      getHoveredId: () => null,
      setHoveredId: () => {},
      getSelectedId: () => null,
      setSelectedId: () => {},
      clearLocalHover: () => {},
      clearLocalSelection: () => {},
      targetPresentation: {
        setHoveredTargets: () => {},
        clearHoveredTargets: () => {},
        setSelectedTargets: () => {},
        clearSelectedTargets: () => {},
      },
      documentEvents: {
        handleMouseMove: () => {},
        handleMouseUp: () => {},
        handleMouseLeave: () => {},
        handleKeyDown: () => {},
      },
    })
    const drag = { id: 'drag-1' }

    frame.beginActiveDrag(drag, {
      beforeFinish: (_activeDrag, mode) => {
        events.push(`before:${mode}`)
      },
      commit: (activeDrag) => {
        events.push(`commit:${activeDrag.id}`)
      },
      abort: (activeDrag) => {
        events.push(`abort:${activeDrag.id}`)
      },
      afterFinish: (_activeDrag, mode) => {
        events.push(`after:${mode}`)
      },
    })

    expect(frame.getActiveDrag()).toBe(drag)
    expect(frame.finishActiveDrag()).toBe(drag)
    expect(frame.getActiveDrag()).toBeNull()
    expect(events).toEqual([
      'before:commit',
      'commit:drag-1',
      'after:commit',
    ])
  })

  it('aborts active drags before clearing presentation during cleanup', () => {
    const events: string[] = []
    const frame = createPlanningCanvasInteractionFrame({
      getHoveredId: () => 'hovered',
      setHoveredId: (id) => {
        events.push(`hover:${id ?? 'null'}`)
      },
      getSelectedId: () => 'selected',
      setSelectedId: (id) => {
        events.push(`selection:${id ?? 'null'}`)
      },
      clearLocalHover: () => {
        events.push('clear-local-hover')
      },
      clearLocalSelection: () => {
        events.push('clear-local-selection')
      },
      targetPresentation: {
        setHoveredTargets: () => {},
        clearHoveredTargets: () => {
          events.push('clear-hover-targets')
        },
        setSelectedTargets: () => {},
        clearSelectedTargets: () => {
          events.push('clear-selection-targets')
        },
      },
      documentEvents: {
        handleMouseMove: () => {},
        handleMouseUp: () => {},
        handleMouseLeave: () => {},
        handleKeyDown: () => {},
      },
    })
    const drag = { id: 'drag-2' }

    frame.beginActiveDrag(drag, {
      beforeFinish: (_activeDrag, mode) => {
        events.push(`before:${mode}`)
      },
      commit: (activeDrag) => {
        events.push(`commit:${activeDrag.id}`)
      },
      abort: (activeDrag) => {
        events.push(`abort:${activeDrag.id}`)
      },
      afterFinish: (_activeDrag, mode) => {
        events.push(`after:${mode}`)
      },
    })

    frame.cleanup()

    expect(frame.getActiveDrag()).toBeNull()
    expect(events).toEqual([
      'before:abort',
      'abort:drag-2',
      'after:abort',
      'hover:null',
      'clear-local-hover',
      'clear-hover-targets',
      'selection:null',
      'clear-local-selection',
      'clear-selection-targets',
    ])
  })

  it('owns document listener lifetime for a planning canvas surface', () => {
    const canvas = document.createElement('canvas')
    const documentMouseMove = vi.fn()
    const documentMouseUp = vi.fn()
    const documentMouseLeave = vi.fn()
    const keyDown = vi.fn()
    const wheel = vi.fn()

    const frame = createPlanningCanvasInteractionFrame({
      getHoveredId: () => null,
      setHoveredId: () => {},
      getSelectedId: () => null,
      setSelectedId: () => {},
      clearLocalHover: () => {},
      clearLocalSelection: () => {},
      targetPresentation: {
        setHoveredTargets: () => {},
        clearHoveredTargets: () => {},
        setSelectedTargets: () => {},
        clearSelectedTargets: () => {},
      },
      documentEvents: {
        handleMouseMove: documentMouseMove,
        handleMouseUp: documentMouseUp,
        handleMouseLeave: documentMouseLeave,
        handleKeyDown: keyDown,
      },
    })

    const dispose = frame.installDocumentListeners({
      canvasRef: { current: canvas },
      handleWheel: wheel,
    })

    canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    document.documentElement.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))

    expect(wheel).toHaveBeenCalledTimes(1)
    expect(documentMouseMove).toHaveBeenCalledTimes(1)
    expect(documentMouseUp).toHaveBeenCalledTimes(1)
    expect(keyDown).toHaveBeenCalledTimes(1)
    expect(documentMouseLeave).toHaveBeenCalledTimes(1)

    dispose()

    canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    document.documentElement.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))

    expect(wheel).toHaveBeenCalledTimes(1)
    expect(documentMouseMove).toHaveBeenCalledTimes(1)
    expect(documentMouseUp).toHaveBeenCalledTimes(1)
    expect(keyDown).toHaveBeenCalledTimes(1)
    expect(documentMouseLeave).toHaveBeenCalledTimes(1)
  })

  it('does not require a wheel listener for planning surfaces without wheel behavior', () => {
    const canvas = document.createElement('canvas')
    const documentMouseMove = vi.fn()

    const frame = createPlanningCanvasInteractionFrame({
      getHoveredId: () => null,
      setHoveredId: () => {},
      getSelectedId: () => null,
      setSelectedId: () => {},
      clearLocalHover: () => {},
      clearLocalSelection: () => {},
      targetPresentation: {
        setHoveredTargets: () => {},
        clearHoveredTargets: () => {},
        setSelectedTargets: () => {},
        clearSelectedTargets: () => {},
      },
      documentEvents: {
        handleMouseMove: documentMouseMove,
        handleMouseUp: () => {},
        handleMouseLeave: () => {},
        handleKeyDown: () => {},
      },
    })

    const dispose = frame.installDocumentListeners({
      canvasRef: { current: canvas },
    })

    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))

    expect(documentMouseMove).toHaveBeenCalledTimes(1)

    dispose()
  })
})
