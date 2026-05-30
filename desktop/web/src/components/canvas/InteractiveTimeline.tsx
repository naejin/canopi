import { createPortal } from 'preact/compat'
import { useEffect, useRef } from 'preact/hooks'
import { useCanvasRenderer } from './useCanvasRenderer'
import { t } from '../../i18n'
import { theme } from '../../app/settings/state'
import { useTimelineCanvasWorkbench } from '../../app/timeline/canvas-workbench'
import {
  renderTimeline,
} from '../../canvas/timeline-renderer'
import { TimelinePopover } from './TimelinePopover'
import styles from './InteractiveTimeline.module.css'

export function InteractiveTimeline() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const workbench = useTimelineCanvasWorkbench({ canvasRef })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.style.height = `${workbench.canvasHeight}px`
    workbench.invalidateLayout()
  }, [workbench.canvasHeight, workbench.invalidateLayout])

  useCanvasRenderer(canvasRef, (ctx, width, height) => {
    renderTimeline(
      ctx,
      width,
      height,
      workbench.rows,
      workbench.layout,
      workbench.renderState,
      t,
      workbench.rowOffsets,
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
