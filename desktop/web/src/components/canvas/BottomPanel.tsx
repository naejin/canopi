import { useEffect, useState } from 'preact/hooks'
import { bottomPanelHeight, bottomPanelOpen } from '../../state/canvas'
import { setBottomPanelHeight } from '../../state/canvas-actions'
import styles from './BottomPanel.module.css'

type LocationComponent = typeof import('./LocationTab').LocationTab

export function BottomPanel() {
  const [LocationTab, setLocationTab] = useState<LocationComponent | null>(null)

  const open = bottomPanelOpen.value
  const height = bottomPanelHeight.value

  useEffect(() => {
    let cancelled = false

    if (!LocationTab) {
      void import('./LocationTab').then((module) => {
        if (!cancelled) setLocationTab(() => module.LocationTab)
      })
    }

    return () => {
      cancelled = true
    }
  }, [LocationTab])

  if (!open) return null

  return (
    <div className={styles.panel} style={{ height: `${height}px` }}>
      <ResizeHandle />
      <div className={styles.content}>
        {LocationTab ? <LocationTab /> : null}
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
