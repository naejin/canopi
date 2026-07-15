import { useRef } from 'preact/hooks'
import { lazy, Suspense } from 'preact/compat'
import { bottomPanelView } from '../../app/canvas-settings/state'
import { commitBottomPanelHeight } from '../../app/canvas-settings/controller'
import { MIN_BOTTOM_PANEL_HEIGHT } from '../../app/canvas-settings/bottom-panel-state'
import { usePointerResize } from '../shared/usePointerResize'
import styles from './BottomPanel.module.css'

const TimelineTab = lazy(async () => {
  const module = await import('./TimelineTab')
  return { default: module.TimelineTab }
})

const BudgetTab = lazy(async () => {
  const module = await import('./BudgetTab')
  return { default: module.BudgetTab }
})

const ConsortiumChart = lazy(async () => {
  const module = await import('./ConsortiumChart')
  return { default: module.ConsortiumChart }
})

export function BottomPanel() {
  if (!bottomPanelView.value.open) return null
  return <BottomPanelInner />
}

function BottomPanelInner() {
  const { tab, height } = bottomPanelView.value
  const panelRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={panelRef} className={styles.panel} style={{ height: `${height}px` }}>
      <ResizeHandle panelRef={panelRef} />
      <div className={styles.content}>
        <Suspense fallback={<div className={styles.loading} aria-hidden="true" />}>
          {tab === 'timeline' && <TimelineTab />}
          {tab === 'budget' && <BudgetTab />}
          {tab === 'consortium' && <ConsortiumChart />}
        </Suspense>
      </div>
    </div>
  )
}

function ResizeHandle({ panelRef }: { panelRef: { current: HTMLDivElement | null } }) {
  const onPointerDown = usePointerResize<BottomPanelResizeSession>({
    cursor: 'row-resize',
    begin: (event) => {
      const panel = panelRef.current
      if (!panel) return null
      return {
        panel,
        startY: event.clientY,
        startHeight: bottomPanelView.peek().height,
        maxHeight: Math.max(200, window.innerHeight * 0.8),
        previousInlineHeight: panel.style.height,
      }
    },
    preview: (session, event) => {
      const height = resolveBottomPanelResizeHeight(session, event.clientY)
      session.panel.style.height = `${height}px`
      return height !== session.startHeight
    },
    commit: (session, event) => {
      commitBottomPanelHeight(resolveBottomPanelResizeHeight(session, event.clientY))
    },
    rollback: (session) => {
      session.panel.style.height = session.previousInlineHeight
    },
  })

  return (
    <div
      className={styles.resizeHandle}
      onPointerDown={onPointerDown}
    />
  )
}

interface BottomPanelResizeSession {
  readonly panel: HTMLDivElement
  readonly startY: number
  readonly startHeight: number
  readonly maxHeight: number
  readonly previousInlineHeight: string
}

function resolveBottomPanelResizeHeight(
  session: BottomPanelResizeSession,
  clientY: number,
): number {
  return Math.max(
    MIN_BOTTOM_PANEL_HEIGHT,
    Math.min(session.maxHeight, session.startHeight + (session.startY - clientY)),
  )
}
