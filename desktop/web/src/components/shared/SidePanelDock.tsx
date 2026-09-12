import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'
import { sidePanelWidth } from '../../app/shell/state'
import { commitSidePanelWidth } from '../../app/shell/controller'
import { t } from '../../i18n'
import { usePointerResize } from './usePointerResize'
import styles from './SidePanelDock.module.css'

const MIN_SIDEBAR_WIDTH = 320
const DEFAULT_SIDEBAR_SIZE = 352
const DEFAULT_SIDEBAR_WIDTH = `clamp(${MIN_SIDEBAR_WIDTH}px, 352px, 90vw)`
const MAX_SIDEBAR_RATIO = 0.9

interface SidebarResizeSession {
  readonly panel: HTMLDivElement
  readonly startX: number
  readonly startWidth: number
  readonly previousInlineWidth: string
}

export function SidePanelDock({
  children,
  responsive = false,
}: {
  readonly children: ComponentChildren
  readonly responsive?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const width = sidePanelWidth.value
  return (
    <>
      <SidePanelResizeHandle panelRef={panelRef} />
      <div
        ref={panelRef}
        className={`${styles.sidePanel} ${responsive ? styles.responsive : ''}`}
        style={
          {
            '--side-panel-width':
              width === null ? DEFAULT_SIDEBAR_WIDTH : `${width}px`,
            ...(responsive
              ? {}
              : { minWidth: `${MIN_SIDEBAR_WIDTH}px`, maxWidth: '90%' }),
          } as Record<string, string>
        }
      >
        {children}
      </div>
    </>
  )
}

function SidePanelResizeHandle({
  panelRef,
}: {
  panelRef: { current: HTMLDivElement | null }
}) {
  const onPointerDown = usePointerResize<SidebarResizeSession>({
    cursor: 'col-resize',
    begin: (event) => {
      const panel = panelRef.current
      if (!panel) return null
      return {
        panel,
        startX: event.clientX,
        startWidth: currentSidebarWidth(panel),
        previousInlineWidth: panel.style.width,
      }
    },
    preview: (session, event) => {
      const width = resolveSidebarWidth(session, event.clientX)
      session.panel.style.width = `${width}px`
      return width !== session.startWidth
    },
    commit: (session, event) => {
      commitSidePanelWidth(resolveSidebarWidth(session, event.clientX))
    },
    rollback: (session) => {
      session.panel.style.width = session.previousInlineWidth
    },
  })

  return (
    <div
      onPointerDown={onPointerDown}
      className={styles.dragHandle}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        const panel = panelRef.current
        if (!panel) return
        event.preventDefault()
        const width =
          currentSidebarWidth(panel) + (event.key === 'ArrowLeft' ? 20 : -20)
        commitSidePanelWidth(
          Math.max(
            MIN_SIDEBAR_WIDTH,
            Math.min(window.innerWidth * MAX_SIDEBAR_RATIO, width),
          ),
        )
      }}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={Math.max(MIN_SIDEBAR_WIDTH, Math.floor(window.innerWidth * MAX_SIDEBAR_RATIO))}
      aria-valuenow={Math.round(sidePanelWidth.value ?? Math.max(MIN_SIDEBAR_WIDTH, Math.min(DEFAULT_SIDEBAR_SIZE, window.innerWidth * MAX_SIDEBAR_RATIO)))}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('sidebar.resize')}
    />
  )
}

function currentSidebarWidth(panel: HTMLDivElement): number {
  const measured = panel.getBoundingClientRect().width
  if (Number.isFinite(measured) && measured > 0) return measured
  return (
    sidePanelWidth.peek() ??
    Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.floor(Math.min(DEFAULT_SIDEBAR_SIZE, window.innerWidth * MAX_SIDEBAR_RATIO)),
    )
  )
}

function resolveSidebarWidth(
  session: SidebarResizeSession,
  clientX: number,
): number {
  // Right-side panel: dragging left = wider (negative delta = larger).
  const delta = session.startX - clientX
  const maxWidth = Math.floor(window.innerWidth * MAX_SIDEBAR_RATIO)
  return Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(maxWidth, session.startWidth + delta),
  )
}
