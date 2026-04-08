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
 * @param cachedRectRef - optional ref invalidated on resize (avoids getBoundingClientRect in hover paths)
 */
export function useCanvasRenderer(
  canvasRef: RefObject<HTMLCanvasElement>,
  render: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  deps: readonly unknown[],
  cachedRectRef?: { current: DOMRect | null },
): void {
  const renderRef = useRef(render)
  renderRef.current = render

  const cachedRectRefInternal = useRef<{ ref: typeof cachedRectRef }>({ ref: cachedRectRef })
  cachedRectRefInternal.current.ref = cachedRectRef

  const doRedraw = useRef(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const cRef = cachedRectRefInternal.current.ref
    const rect = cRef?.current ?? canvas.getBoundingClientRect()
    if (cRef) cRef.current = rect
    if (rect.width === 0 || rect.height === 0) return

    const dpr = window.devicePixelRatio || 1
    const newW = Math.round(rect.width * dpr)
    const newH = Math.round(rect.height * dpr)
    if (canvas.width !== newW) canvas.width = newW
    if (canvas.height !== newH) canvas.height = newH

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
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

    const observer = new ResizeObserver(() => {
      if (cachedRectRef) cachedRectRef.current = null
      doRedraw.current()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])
}
