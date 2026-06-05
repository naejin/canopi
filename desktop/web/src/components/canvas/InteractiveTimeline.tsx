import { createPortal } from 'preact/compat'
import { useCanvasRenderer } from './useCanvasRenderer'
import { useTimelineActionCanvasHostModel } from '../../app/timeline/canvas'
import { TimelinePopover } from './TimelinePopover'
import styles from './InteractiveTimeline.module.css'

export function InteractiveTimeline() {
  const hostModel = useTimelineActionCanvasHostModel()

  useCanvasRenderer(
    hostModel.renderer.canvasRef,
    hostModel.renderer.render,
    hostModel.renderer.deps,
    hostModel.renderer.cachedRectRef,
  )

  const tooltip = hostModel.overlays.tooltip
  const popover = hostModel.overlays.popover

  return (
    <div ref={hostModel.container.ref} className={styles.container} onScroll={hostModel.container.onScroll}>
      <canvas
        ref={hostModel.canvas.ref}
        className={styles.timeline}
        onMouseDown={hostModel.canvas.onMouseDown}
        onMouseMove={hostModel.canvas.onMouseMove}
        onMouseLeave={hostModel.canvas.onMouseLeave}
        aria-label={hostModel.canvas.ariaLabel}
      />
      {tooltip && (
        <div
          className={styles.tooltip}
          style={{
            left: tooltip.x,
            top: tooltip.y,
          }}
        >
          <div className={styles.tooltipType}>{tooltip.typeLabel}</div>
          {tooltip.dates && (
            <div className={styles.tooltipDates}>
              {tooltip.dates}
            </div>
          )}
          {tooltip.description && (
            <div className={styles.tooltipDesc}>
              {tooltip.description}
            </div>
          )}
        </div>
      )}
      {popover && createPortal(
        <TimelinePopover {...popover.props} />,
        document.body,
      )}
    </div>
  )
}
