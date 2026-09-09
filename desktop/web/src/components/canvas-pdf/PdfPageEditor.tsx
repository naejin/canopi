import { useEffect, useId, useRef, useState } from 'preact/hooks'
import type { PrintBounds, PrintPoint, PrintZone } from '../../canvas/print'
import type { PdfPage, PdfPlan } from '../../app/canvas-pdf/types'
import { t } from '../../i18n'
import { PdfPageArtwork } from './PdfPagePreview'

interface EditorProps {
  readonly page: PdfPage
  readonly plan: PdfPlan
  readonly adding?: boolean
  readonly disabled?: boolean
  readonly inspecting?: boolean
  readonly zones?: readonly PrintZone[]
  readonly highlightedPage?: string | null
  readonly onPrintArea?: (bounds: PrintBounds) => void
  readonly onZone?: (name: string) => void
  readonly onPage?: (id: string) => void
  /** Delta of the view centre in metres, committed once per completed gesture. */
  readonly onMove?: (delta: PrintPoint) => void
}
interface Gesture {
  readonly start: PrintPoint
  readonly pointerId: number
  readonly bounds: DOMRect
  readonly zone?: string
  readonly pageId?: string
}
export function PdfPageEditor({ page, plan, adding = false, disabled = false, inspecting = false, zones = [], highlightedPage,
  onPrintArea, onZone, onPage, onMove }: EditorProps) {
  const root = useRef<SVGSVGElement>(null)
  const drag = useRef<Gesture | null>(null)
  const [selection, setSelection] = useState<PrintBounds | null>(null)
  const [hoveredZone, setHoveredZone] = useState<string | null>(null)
  const clipId = useId()
  const interactive = !disabled && !inspecting && page.kind !== 'legend'
  function cancel() {
    const previous = drag.current; drag.current = null; setSelection(null)
    root.current?.style.removeProperty('--pdf-drag-x'); root.current?.style.removeProperty('--pdf-drag-y')
    if (previous && root.current?.hasPointerCapture(previous.pointerId)) root.current.releasePointerCapture(previous.pointerId)
  }
  // A new plan, mode, or unmount cancels gestures against the old geometry.
  useEffect(() => { cancel(); setHoveredZone(null); return cancel }, [page, adding, disabled, inspecting])
  function point(event: PointerEvent, bounds: DOMRect): PrintPoint {
    const scale = Math.min(bounds.width / page.width, bounds.height / page.height)
    return { x: (event.clientX - bounds.left - (bounds.width - page.width * scale) / 2) / scale,
      y: (event.clientY - bounds.top - (bounds.height - page.height * scale) / 2) / scale }
  }
  function rectangle(end: PrintPoint): PrintBounds {
    const start = drag.current!.start
    const x = Math.max(page.frame.x, Math.min(page.frame.x + page.frame.width, end.x))
    const y = Math.max(page.frame.y, Math.min(page.frame.y + page.frame.height, end.y))
    return { x: Math.min(start.x, x), y: Math.min(start.y, y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) }
  }
  function pointerDown(event: PointerEvent) {
    if (!interactive || event.button !== 0 || drag.current) return
    const bounds = root.current!.getBoundingClientRect(), start = point(event, bounds)
    if (![start.x, start.y].every(Number.isFinite) || start.x < page.frame.x || start.x > page.frame.x + page.frame.width
      || start.y < page.frame.y || start.y > page.frame.y + page.frame.height) return
    event.preventDefault(); event.stopPropagation(); root.current!.focus()
    const target = event.target instanceof Element ? event.target : null
    drag.current = { start, bounds, pointerId: event.pointerId,
      zone: target?.getAttribute('data-pdf-zone') ?? undefined, pageId: target?.getAttribute('data-pdf-target') ?? undefined }
    root.current!.setPointerCapture(event.pointerId)
  }
  function pointerMove(event: PointerEvent) {
    const gesture = drag.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    event.preventDefault()
    const end = point(event, gesture.bounds)
    if (adding) setSelection(rectangle(end))
    else {
      root.current!.style.setProperty('--pdf-drag-x', `${end.x - gesture.start.x}px`)
      root.current!.style.setProperty('--pdf-drag-y', `${end.y - gesture.start.y}px`)
    }
  }
  function pointerUp(event: PointerEvent) {
    const gesture = drag.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const end = point(event, gesture.bounds), bounds = rectangle(end)
    const scale = Math.min(gesture.bounds.width / page.width, gesture.bounds.height / page.height)
    const moved = Math.hypot(end.x - gesture.start.x, end.y - gesture.start.y) * scale >= 4
    cancel()
    if (!moved) { if (adding && gesture.zone) onZone?.(gesture.zone); else if (!adding && gesture.pageId) onPage?.(gesture.pageId); return }
    if (adding) {
      if (bounds.width < 2 || bounds.height < 2) return
      onPrintArea?.({ x: page.ground.x + (bounds.x - page.frame.x) / page.pointsPerMeter,
        y: page.ground.y + (bounds.y - page.frame.y) / page.pointsPerMeter,
        width: bounds.width / page.pointsPerMeter, height: bounds.height / page.pointsPerMeter })
    } else onMove?.({ x: (gesture.start.x - end.x) / page.pointsPerMeter, y: (gesture.start.y - end.y) / page.pointsPerMeter })
  }
  const groundTransform = `translate(${page.frame.x - page.ground.x * page.pointsPerMeter} ${page.frame.y - page.ground.y * page.pointsPerMeter}) scale(${page.pointsPerMeter})`
  return <svg ref={root} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${page.width} ${page.height}`}
    role="group" tabindex={0} aria-label={t('pdf.pageCount', { page: page.number, count: plan.pages.length })}
    aria-describedby="pdf-editor-hint" data-pdf-editor data-pdf-page={page.number}
    width={inspecting ? page.width * 2 : '100%'} height={inspecting ? page.height * 2 : '100%'}
    style={{ touchAction: interactive ? 'none' : undefined, cursor: interactive ? adding ? 'crosshair' : 'grab' : undefined }}
    onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancel} onLostPointerCapture={cancel}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); return }
      if (!interactive || adding || event.altKey || event.ctrlKey || event.metaKey) return
      const delta = event.shiftKey ? 30 : 5
      const direction = { ArrowLeft: [delta, 0], ArrowRight: [-delta, 0], ArrowUp: [0, delta], ArrowDown: [0, -delta] }[event.key]
      if (direction) { event.preventDefault(); onMove?.({ x: direction[0]! / page.pointsPerMeter, y: direction[1]! / page.pointsPerMeter }) }
    }}>
    <desc>{page.legend.map((entry) => entry.name).join('; ')}</desc>
    <PdfPageArtwork page={page} plan={plan} />
    <defs><clipPath id={clipId}><rect {...page.frame} /></clipPath></defs>
    <g clip-path={`url(#${clipId})`}>
      {interactive && adding && zones.map((zone) => <path key={zone.name} d={zone.path} transform={groundTransform}
        data-pdf-zone={zone.name} fill={/[zZ]\s*$/.test(zone.path) ? hoveredZone === zone.name ? 'var(--color-primary-bg)' : 'transparent' : 'none'}
        stroke={hoveredZone === zone.name ? 'var(--color-primary)' : 'var(--color-border-strong)'} stroke-width={(hoveredZone === zone.name ? 2 : 1) / page.pointsPerMeter}
        pointer-events={/[zZ]\s*$/.test(zone.path) ? 'all' : 'stroke'} onPointerEnter={() => { if (!drag.current) setHoveredZone(zone.name) }} onPointerLeave={() => setHoveredZone(null)}><title>{zone.name}</title></path>)}
      {!adding && page.kind === 'overview' && plan.pages.filter((detail) => detail.kind === 'detail').map((detail) => <rect key={detail.id}
        x={page.frame.x + (detail.ground.x - page.ground.x) * page.pointsPerMeter} y={page.frame.y + (detail.ground.y - page.ground.y) * page.pointsPerMeter}
        width={detail.ground.width * page.pointsPerMeter} height={detail.ground.height * page.pointsPerMeter} data-pdf-target={detail.id}
        fill={highlightedPage === detail.id ? 'var(--color-primary-bg)' : 'transparent'} stroke={highlightedPage === detail.id ? 'var(--color-primary)' : 'none'} stroke-width="2"
        style={{ pointerEvents: interactive ? 'all' : 'none', cursor: 'pointer', transform: 'translate(var(--pdf-drag-x, 0px), var(--pdf-drag-y, 0px))' }}>
        <title>{detail.areaName}</title></rect>)}
      {selection && <rect data-print-area-draft {...selection} fill="var(--color-primary-bg)" stroke="var(--color-primary)" stroke-width="1" stroke-dasharray="4 2" pointer-events="none" />}
    </g>
  </svg>
}
