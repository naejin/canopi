import { useEffect, useMemo, useRef } from 'preact/hooks'
import { t } from '../../i18n'
import { theme } from '../../app/settings/state'
import { useConsortiumCanvasWorkbench } from '../../app/consortium/workbench'
import { useConsortiumPlanningSurface } from '../../app/planning-projection'
import {
  renderConsortium,
  computeRowHeights,
  computeRowYOffsets,
  HEADER_HEIGHT,
  type ConsortiumRenderState,
} from '../../canvas/consortium-renderer'
import { useCanvasRenderer } from './useCanvasRenderer'
import styles from './ConsortiumChart.module.css'

export function ConsortiumChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const { consortiums, projection, activeLocale } = useConsortiumPlanningSurface()
  const bars = projection.bars
  const rowHeights = useMemo(() => computeRowHeights(bars), [bars])
  const rowOffsets = useMemo(() => computeRowYOffsets(rowHeights), [rowHeights])

  const workbench = useConsortiumCanvasWorkbench({
    canvasRef,
    bars,
    consortiums,
    rowHeights,
    rowOffsets,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const totalHeight = HEADER_HEIGHT + rowHeights.reduce((a, b) => a + b, 0)
    canvas.style.height = `${totalHeight}px`
    workbench.invalidateLayout()
  }, [rowHeights, workbench.invalidateLayout])

  useCanvasRenderer(canvasRef, (ctx, width, height) => {
    const state: ConsortiumRenderState = {
      hoveredCanonical: workbench.effectiveHoveredCanonical,
    }
    renderConsortium(ctx, width, height, bars, state, t, rowHeights, rowOffsets)
  }, [bars, workbench.effectiveHoveredCanonical, activeLocale, theme.value], workbench.cachedRectRef)

  return (
    <div className={styles.container}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onMouseDown={workbench.handleMouseDown}
        onMouseMove={workbench.handleCanvasMouseMove}
        onMouseLeave={workbench.handleMouseLeave}
        aria-label={t('canvas.consortium.title')}
      />
      {bars.length === 0 && (
        <div className={styles.emptyOverlay}>
          {t('canvas.consortium.empty')}
        </div>
      )}
    </div>
  )
}
