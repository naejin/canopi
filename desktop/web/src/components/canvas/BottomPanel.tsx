import { bottomPanelHeight, bottomPanelOpen, bottomPanelTab } from '../../state/canvas'
import { setBottomPanelHeight } from '../../state/canvas-actions'
import { TimelineTab } from './TimelineTab'
import { BudgetTab } from './BudgetTab'
import { ConsortiumChart } from './ConsortiumChart'
import styles from './BottomPanel.module.css'

export function BottomPanel() {
  const open = bottomPanelOpen.value
  const height = bottomPanelHeight.value

  if (!open) return null

  return (
    <div className={styles.panel} style={{ height: `${height}px` }}>
      <ResizeHandle />
      <div className={styles.content}>
        {bottomPanelTab.value === 'timeline' && <TimelineTab />}
        {bottomPanelTab.value === 'budget' && <BudgetTab />}
        {bottomPanelTab.value === 'consortium' && <ConsortiumChart />}
      </div>
    </div>
  )
}

function ResizeHandle() {
  return (
    <div
      className={styles.resizeHandle}
      onMouseDown={(event) => {
        event.preventDefault()
        const startY = event.clientY
        const startHeight = bottomPanelHeight.value
        const maxHeight = Math.max(200, window.innerHeight * 0.8)

        const onMove = (moveEvent: MouseEvent) => {
          const delta = startY - moveEvent.clientY
          setBottomPanelHeight(Math.max(140, Math.min(maxHeight, startHeight + delta)))
        }

        const onUp = () => {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
        }

        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
        document.body.style.cursor = 'row-resize'
        document.body.style.userSelect = 'none'
      }}
    />
  )
}
