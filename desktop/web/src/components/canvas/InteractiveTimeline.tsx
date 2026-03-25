import { useRef, useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { currentDesign } from '../../state/document'
import { celestialDate } from '../../state/canvas'
import { renderTimeline, hitTestAction, type TimelineRenderState } from '../../canvas/timeline-renderer'
import styles from './InteractiveTimeline.module.css'

const DEFAULT_PX_PER_DAY = 4
const ZOOM_FACTOR = 1.15
const MIN_PX_PER_DAY = 0.1
const MAX_PX_PER_DAY = 50

export function InteractiveTimeline() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pxPerDay = useSignal(DEFAULT_PX_PER_DAY)
  const scrollX = useSignal(0)
  const selectedId = useSignal<string | null>(null)

  const actions = currentDesign.value?.timeline ?? []

  // Find the earliest date for the origin
  const originDate = _computeOriginDate(actions)

  const state: TimelineRenderState = {
    originDate,
    pxPerDay: pxPerDay.value,
    scrollX: scrollX.value,
    selectedId: selectedId.value,
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function redraw() {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas!.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      canvas!.width = rect.width * dpr
      canvas!.height = rect.height * dpr
      const ctx = canvas!.getContext('2d')
      if (!ctx) return
      renderTimeline(ctx, rect.width, rect.height, actions, state)
    }

    redraw()

    // Re-render on container resize (e.g., bottom panel drag)
    const observer = new ResizeObserver(() => redraw())
    observer.observe(canvas)
    return () => observer.disconnect()
  })

  function handleWheel(e: WheelEvent) {
    e.preventDefault()

    if (e.ctrlKey || e.metaKey) {
      // Zoom — centered on cursor
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left

      const oldPxPerDay = pxPerDay.value
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      const newPxPerDay = Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, oldPxPerDay * factor))

      // Adjust scrollX to keep the point under the cursor fixed
      const worldXUnderCursor = (scrollX.value + mx) / oldPxPerDay
      scrollX.value = worldXUnderCursor * newPxPerDay - mx

      pxPerDay.value = newPxPerDay
    } else {
      // Pan — horizontal scroll
      scrollX.value += e.deltaY + e.deltaX
    }
  }

  function handleMouseDown(e: MouseEvent) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const hit = hitTestAction(x, y, actions, state)
    if (hit) {
      selectedId.value = hit.id
      // Drive celestial dial
      if (hit.start_date) {
        celestialDate.value = new Date(hit.start_date)
      }
    } else {
      selectedId.value = null
    }
  }

  // Middle-click drag to pan
  const dragStart = useSignal<{ x: number; scrollX: number } | null>(null)

  function handleMouseDownPan(e: MouseEvent) {
    if (e.button === 1) { // middle click
      e.preventDefault()
      dragStart.value = { x: e.clientX, scrollX: scrollX.value }
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (dragStart.value) {
      scrollX.value = dragStart.value.scrollX - (e.clientX - dragStart.value.x)
    }
  }

  function handleMouseUp() {
    dragStart.value = null
  }

  return (
    <canvas
      ref={canvasRef}
      className={styles.timeline}
      onWheel={handleWheel}
      onMouseDown={(e: MouseEvent) => { handleMouseDown(e); handleMouseDownPan(e) }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    />
  )
}

function _computeOriginDate(actions: { start_date: string | null }[]): Date {
  let earliest = new Date()
  for (const a of actions) {
    if (a.start_date) {
      const d = new Date(a.start_date)
      if (d < earliest) earliest = d
    }
  }
  // Pad 30 days before earliest
  return new Date(earliest.getTime() - 30 * 24 * 60 * 60 * 1000)
}
