import { useEffect, useMemo, useRef } from 'preact/hooks'
import {
  useTimelinePlanningSurface,
} from '../../planning-projection'
import {
  RULER_HEIGHT,
  computeTimelineRowOffsets,
  renderTimeline,
} from '../../../canvas/timeline-renderer'
import { t } from '../../../i18n'
import { theme } from '../../settings/state'
import type { TimelineAction } from '../../../types/design'
import type { TimelineActionFormData } from '../editing'
import {
  createTimelineActionCanvasController,
  type TimelineActionCanvasController,
} from './controller'
import type { TimelineActionPopoverState } from '../workbench'

interface MutableDomRef<T> {
  current: T | null
}

export interface TimelineActionCanvasHostModel {
  readonly container: TimelineActionCanvasContainerModel
  readonly canvas: TimelineActionCanvasElementModel
  readonly renderer: TimelineActionCanvasRendererModel
  readonly overlays: TimelineActionCanvasOverlayModel
}

export interface TimelineActionCanvasContainerModel {
  readonly ref: MutableDomRef<HTMLDivElement>
  readonly onScroll: () => void
}

export interface TimelineActionCanvasElementModel {
  readonly ref: MutableDomRef<HTMLCanvasElement>
  readonly ariaLabel: string
  readonly onMouseDown: (event: MouseEvent) => void
  readonly onMouseMove: (event: MouseEvent) => void
  readonly onMouseLeave: () => void
}

export interface TimelineActionCanvasRendererModel {
  readonly canvasRef: MutableDomRef<HTMLCanvasElement>
  readonly render: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
  readonly deps: readonly unknown[]
  readonly cachedRectRef: MutableDomRef<DOMRect>
}

export interface TimelineActionCanvasOverlayModel {
  readonly tooltip: TimelineActionCanvasTooltipOverlay | null
  readonly popover: TimelineActionCanvasPopoverOverlay | null
}

export interface TimelineActionCanvasTooltipOverlay {
  readonly x: number
  readonly y: number
  readonly typeLabel: string
  readonly dates: string | null
  readonly description: string | null
}

export interface TimelineActionCanvasPopoverOverlay {
  readonly props: {
    readonly mode: TimelineActionPopoverState['mode']
    readonly anchorX: number
    readonly anchorY: number
    readonly initialData: TimelineActionFormData
    readonly speciesList: TimelineActionPopoverState['speciesList']
    readonly onSave: (data: TimelineActionFormData) => void
    readonly onDelete?: () => void
    readonly onCancel: () => void
  }
}

const EMPTY_ACTIONS: TimelineAction[] = []

export function useTimelineActionCanvasHostModel(): TimelineActionCanvasHostModel {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fallbackOriginMs = useMemo(() => Date.now(), [])
  const {
    actions,
    projection,
    activeLocale,
    speciesColors,
  } = useTimelinePlanningSurface({ fallbackOriginMs })
  const rows = projection.rows
  const layout = projection.layout
  const originMs = projection.originMs
  const originDate = useMemo(() => new Date(originMs), [originMs])
  const rowOffsets = useMemo(() => computeTimelineRowOffsets(rows, layout), [rows, layout])
  const canvasHeight = rowOffsets[rowOffsets.length - 1] ?? RULER_HEIGHT
  const cachedRectRef = useRef<DOMRect | null>(null)
  const canvasControllerRef = useRef<TimelineActionCanvasController | null>(null)
  const activeTheme = theme.value

  if (!canvasControllerRef.current) {
    canvasControllerRef.current = createTimelineActionCanvasController({
      canvasRef,
      cachedRectRef,
    })
  }
  const canvasController = canvasControllerRef.current
  canvasController.updateInputs({
    rows,
    layout,
    rowOffsets,
    projection,
    originDate,
    originMs,
    activeLocale,
    speciesColors,
  })

  const renderState = canvasController.readRenderState()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.style.height = `${canvasHeight}px`
    cachedRectRef.current = null
  }, [canvasHeight])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) canvas.addEventListener('wheel', canvasController.handleWheel, { passive: false })

    const onMove = (event: MouseEvent) => {
      canvasController.handleDocumentMouseMove(event)
    }
    const onUp = (event: MouseEvent) => {
      canvasController.handleDocumentMouseUp(event)
    }
    const onLeave = () => {
      canvasController.handleDocumentMouseLeave()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      canvasController.handleKeyDown(event)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKeyDown)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      if (canvas) canvas.removeEventListener('wheel', canvasController.handleWheel)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKeyDown)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      canvasController.cleanup()
    }
  }, [canvasRef, canvasController])

  useEffect(() => {
    canvasController.syncActions(actions ?? EMPTY_ACTIONS)
  }, [actions, canvasController, canvasController.hoveredId.value, canvasController.selectedId.value])

  const popover = canvasController.popover.value
  const tooltip = canvasController.tooltip.value

  const tooltipOverlay: TimelineActionCanvasTooltipOverlay | null = tooltip && !popover
    ? {
        x: Math.min(tooltip.x + 12, (containerRef.current?.clientWidth ?? 300) - 230),
        y: tooltip.y + 12,
        typeLabel: t(`canvas.timeline.type_${tooltip.action.actionType}`),
        dates: tooltip.action.startDate
          ? `${tooltip.action.startDate}${tooltip.action.endDate ? ` - ${tooltip.action.endDate}` : ''}`
          : null,
        description: tooltip.action.description
          ? tooltip.action.description.length > 50
            ? `${tooltip.action.description.slice(0, 50)}...`
            : tooltip.action.description
          : null,
      }
    : null

  const popoverOverlay: TimelineActionCanvasPopoverOverlay | null = popover
    ? {
        props: {
          mode: popover.mode,
          anchorX: popover.anchorX,
          anchorY: popover.anchorY,
          initialData: popover.formData,
          speciesList: popover.speciesList,
          onSave: canvasController.handlePopoverSave,
          ...(popover.mode === 'edit' ? { onDelete: canvasController.handlePopoverDelete } : {}),
          onCancel: canvasController.handlePopoverCancel,
        },
      }
    : null

  return {
    container: {
      ref: containerRef,
      onScroll: canvasController.handleContainerScroll,
    },
    canvas: {
      ref: canvasRef,
      ariaLabel: t('canvas.timeline.title'),
      onMouseDown: canvasController.handleMouseDown,
      onMouseMove: canvasController.handleCanvasMouseMove,
      onMouseLeave: canvasController.handleMouseLeave,
    },
    renderer: {
      canvasRef,
      render: (ctx, width, height) => {
        renderTimeline(
          ctx,
          width,
          height,
          rows,
          layout,
          renderState,
          t,
          rowOffsets,
        )
      },
      deps: [
        rows,
        layout,
        rowOffsets,
        originMs,
        canvasController.pxPerDay.value,
        canvasController.scrollX.value,
        canvasController.selectedId.value,
        canvasController.hoveredId.value,
        activeLocale,
        speciesColors,
        canvasController.granularity.value,
        activeTheme,
      ],
      cachedRectRef,
    },
    overlays: {
      tooltip: tooltipOverlay,
      popover: popoverOverlay,
    },
  }
}
