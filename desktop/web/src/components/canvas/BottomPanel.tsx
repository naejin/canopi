import { useEffect, useRef } from 'preact/hooks'
import { bottomPanelHeight, bottomPanelOpen, bottomPanelTab } from '../../state/canvas'
import { commitBottomPanelHeight } from '../../state/canvas-actions'
import { TimelineTab } from './TimelineTab'
import { BudgetTab } from './BudgetTab'
import { ConsortiumChart } from './ConsortiumChart'
import styles from './BottomPanel.module.css'

export function BottomPanel() {
  const open = bottomPanelOpen.value
  const tab = bottomPanelTab.value
  const height = bottomPanelHeight.value
  const panelRef = useRef<HTMLDivElement>(null)

  if (!open) return null
  return (
    <div ref={panelRef} className={styles.panel} style={{ height: `${height}px` }}>
      <ResizeHandle panelRef={panelRef} />
      <div className={styles.content}>
        {tab === 'timeline' && <TimelineTab />}
        {tab === 'budget' && <BudgetTab />}
        {tab === 'consortium' && <ConsortiumChart />}
      </div>
    </div>
  )
}

function ResizeHandle({ panelRef }: { panelRef: { current: HTMLDivElement | null } }) {
  const handleRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<((commit: boolean) => void) | null>(null)

  useEffect(() => {
    return () => { cleanupRef.current?.(false) }
  }, [])

  return (
    <div
      ref={handleRef}
      className={styles.resizeHandle}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()

        const handle = handleRef.current
        if (!handle) return
        handle.setPointerCapture(event.pointerId)

        const startY = event.clientY
        const startHeight = bottomPanelHeight.peek()
        const maxHeight = Math.max(200, window.innerHeight * 0.8)

        const clampHeight = (clientY: number) =>
          Math.max(140, Math.min(maxHeight, startHeight + (startY - clientY)))

        let lastClientY = event.clientY
        const pointerId = event.pointerId

        const onMove = (moveEvent: PointerEvent) => {
          lastClientY = moveEvent.clientY
          if (panelRef.current) panelRef.current.style.height = `${clampHeight(moveEvent.clientY)}px`
        }

        let cleaned = false
        const cleanup = (commit: boolean) => {
          if (cleaned) return
          cleaned = true
          handle.removeEventListener('pointermove', onMove)
          handle.removeEventListener('pointerup', onUp)
          handle.removeEventListener('lostpointercapture', onLost)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
          if (commit) commitBottomPanelHeight(clampHeight(lastClientY))
          cleanupRef.current = null
        }

        const onUp = (upEvent: PointerEvent) => {
          lastClientY = upEvent.clientY
          handle.releasePointerCapture(pointerId)
          cleanup(true)
        }

        const onLost = () => {
          cleanup(true)
        }

        handle.addEventListener('pointermove', onMove)
        handle.addEventListener('pointerup', onUp)
        handle.addEventListener('lostpointercapture', onLost)
        document.body.style.cursor = 'row-resize'
        document.body.style.userSelect = 'none'
        cleanupRef.current = cleanup
      }}
    />
  )
}
