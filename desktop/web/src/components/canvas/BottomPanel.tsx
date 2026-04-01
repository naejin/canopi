import type * as preact from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { bottomPanelHeight, bottomPanelOpen, bottomPanelTab, type BottomPanelTab } from '../../state/canvas'
import { setBottomPanelHeight } from '../../state/canvas-actions'
import styles from './BottomPanel.module.css'

type BottomPanelComponent = () => preact.JSX.Element

async function loadBottomPanelTab(tab: BottomPanelTab): Promise<BottomPanelComponent> {
  switch (tab) {
    case 'location':
      return (await import('./LocationTab')).LocationTab
    case 'timeline':
      return (await import('./TimelineTab')).TimelineTab
    case 'budget':
      return (await import('./BudgetTab')).BudgetTab
    case 'consortium':
      return (await import('./ConsortiumTab')).ConsortiumTab
  }
}

export function BottomPanel() {
  const [PanelContent, setPanelContent] = useState<BottomPanelComponent | null>(null)

  const open = bottomPanelOpen.value
  const height = bottomPanelHeight.value
  const tab = bottomPanelTab.value

  useEffect(() => {
    let cancelled = false

    setPanelContent(null)
    void loadBottomPanelTab(tab).then((component) => {
      if (!cancelled) setPanelContent(() => component)
    })

    return () => {
      cancelled = true
    }
  }, [tab])

  if (!open) return null

  return (
    <div className={styles.panel} style={{ height: `${height}px` }}>
      <ResizeHandle />
      <div className={styles.content}>
        {PanelContent ? <PanelContent /> : null}
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

        const onMove = (moveEvent: MouseEvent) => {
          const delta = startY - moveEvent.clientY
          const maxHeight = Math.max(200, window.innerHeight * 0.8)
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
