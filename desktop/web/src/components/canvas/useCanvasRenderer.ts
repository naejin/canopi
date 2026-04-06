import { useEffect, useRef } from 'preact/hooks'
import type { RefObject } from 'preact'

/**
 * Shared hook for DPR-aware Canvas2D rendering with ResizeObserver.
 *
 * The render function receives the 2D context and logical (CSS) dimensions.
 * DPR scaling is handled automatically — render at logical pixels.
 *
 * @param canvasRef - ref to the canvas element
 * @param render - called on every redraw with (ctx, width, height)
 * @param deps - triggers a redraw when any dependency changes (same semantics as useEffect deps)
 */
export function useCanvasRenderer(
  canvasRef: RefObject<HTMLCanvasElement>,
  render: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  deps: readonly unknown[],
): void {
  const renderRef = useRef(render)
  renderRef.current = render

  const doRedraw = useRef(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    renderRef.current(ctx, rect.width, rect.height)
  })

  // Redraw when deps change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    doRedraw.current()
  }, deps)

  // ResizeObserver — stable, registered once
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const observer = new ResizeObserver(() => doRedraw.current())
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])
}
