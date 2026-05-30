import { createPortal } from 'preact/compat'
import { useEffect, useMemo, useRef } from 'preact/hooks'
import { useCanvasRenderer } from './useCanvasRenderer'
import { t } from '../../i18n'
import { locale, theme } from '../../app/settings/state'
import { plantSpeciesColorDefaults } from '../../canvas/plant-species-color-defaults'
import { currentDesign } from '../../app/document-session/store'
import { useTimelinePlanningProjection } from '../../app/planning-projection'
import { useTimelineCanvasWorkbench } from '../../app/timeline/canvas-workbench'
import {
  RULER_HEIGHT,
  computeTimelineRowOffsets,
  renderTimeline,
} from '../../canvas/timeline-renderer'
import type { TimelineAction } from '../../types/design'
import { TimelinePopover } from './TimelinePopover'
import styles from './InteractiveTimeline.module.css'

interface InteractiveTimelineProps {
  selectedId: string | null
  onSelect: (id: string | null) => void
}

const EMPTY_ACTIONS: TimelineAction[] = []

export function InteractiveTimeline({
  selectedId,
  onSelect,
}: InteractiveTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const actions = currentDesign.value?.timeline ?? EMPTY_ACTIONS
  const speciesColors = plantSpeciesColorDefaults.value
  const todayMs = useMemo(() => Date.now(), [])
  const activeLocale = locale.value
  const projection = useTimelinePlanningProjection({
    actions,
    fallbackOriginMs: todayMs,
    locale: activeLocale,
  })
  const rows = projection.rows
  const layout = projection.layout
  const originMs = projection.originMs
  const originDate = useMemo(() => new Date(originMs), [originMs])
  const rowOffsets = useMemo(() => computeTimelineRowOffsets(rows, layout), [rows, layout])

  const workbench = useTimelineCanvasWorkbench({
    canvasRef,
    rows,
    layout,
    rowOffsets,
    projection,
    originDate,
    originMs,
    selectedId,
    onSelect,
    locale: activeLocale,
    speciesColors,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const totalHeight = rowOffsets[rowOffsets.length - 1] ?? RULER_HEIGHT
    canvas.style.height = `${totalHeight}px`
    workbench.invalidateLayout()
  }, [rowOffsets, workbench.invalidateLayout])

  useCanvasRenderer(canvasRef, (ctx, width, height) => {
    renderTimeline(
      ctx,
      width,
      height,
      rows,
      layout,
      workbench.renderState,
      t,
      rowOffsets,
    )
  }, [...workbench.renderDeps, theme.value], workbench.cachedRectRef)

  const ps = workbench.popover
  const tip = workbench.tooltip

  return (
    <div ref={containerRef} className={styles.container} onScroll={workbench.handleContainerScroll}>
      <canvas
        ref={canvasRef}
        className={styles.timeline}
        onMouseDown={workbench.handleMouseDown}
        onMouseMove={workbench.handleCanvasMouseMove}
        onMouseLeave={workbench.handleMouseLeave}
        aria-label={t('canvas.timeline.title')}
      />
      {tip && !ps && (
        <div
          className={styles.tooltip}
          style={{
            left: Math.min(tip.x + 12, (containerRef.current?.clientWidth ?? 300) - 230),
            top: tip.y + 12,
          }}
        >
          <div className={styles.tooltipType}>{t(`canvas.timeline.type_${tip.action.actionType}`)}</div>
          {tip.action.startDate && (
            <div className={styles.tooltipDates}>
              {tip.action.startDate}{tip.action.endDate ? ` - ${tip.action.endDate}` : ''}
            </div>
          )}
          {tip.action.description && (
            <div className={styles.tooltipDesc}>
              {tip.action.description.length > 50
                ? `${tip.action.description.slice(0, 50)}...`
                : tip.action.description}
            </div>
          )}
        </div>
      )}
      {ps && createPortal(
        <TimelinePopover
          mode={ps.mode}
          anchorX={ps.anchorX}
          anchorY={ps.anchorY}
          initialData={ps.formData}
          speciesList={ps.speciesList}
          onSave={workbench.handlePopoverSave}
          onDelete={ps.mode === 'edit' ? workbench.handlePopoverDelete : undefined}
          onCancel={workbench.handlePopoverCancel}
        />,
        document.body,
      )}
    </div>
  )
}
