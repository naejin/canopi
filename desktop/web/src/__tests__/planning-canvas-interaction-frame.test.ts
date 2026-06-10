import { describe, expect, it, vi } from 'vitest'
import { createPlanningCanvasInteractionFrame } from '../app/planning-canvas/interaction-frame'

describe('Planning Canvas interaction frame', () => {
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
