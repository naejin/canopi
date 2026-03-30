import { useEffect, useState } from 'preact/hooks'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { bottomPanelHeight, bottomPanelOpen, bottomPanelTab, type BottomPanelTab } from '../../state/canvas'
import {
  setBottomPanelHeight,
  setBottomPanelOpen,
  setBottomPanelTab,
} from '../../state/canvas-actions'
import styles from './BottomPanel.module.css'

type LocationComponent = typeof import('./LocationTab').LocationTab
type ConsortiumComponent = typeof import('./ConsortiumTab').ConsortiumTab

const TAB_ORDER: BottomPanelTab[] = ['location', 'consortium']

function getTabLabel(tab: BottomPanelTab): string {
  if (tab === 'location') return t('canvas.location.title')
  return t('canvas.bottomPanel.consortium')
}

export function BottomPanel() {
  void locale.value

  const [LocationTab, setLocationTab] = useState<LocationComponent | null>(null)
  const [ConsortiumTab, setConsortiumTab] = useState<ConsortiumComponent | null>(null)

  const open = bottomPanelOpen.value
  const activeTab = bottomPanelTab.value
  const height = bottomPanelHeight.value

  useEffect(() => {
    let cancelled = false

    if (activeTab === 'location' && !LocationTab) {
      void import('./LocationTab').then((module) => {
        if (!cancelled) setLocationTab(() => module.LocationTab)
      })
    }

    if (activeTab === 'consortium' && !ConsortiumTab) {
      void import('./ConsortiumTab').then((module) => {
        if (!cancelled) setConsortiumTab(() => module.ConsortiumTab)
      })
    }

    return () => {
      cancelled = true
    }
  }, [activeTab, LocationTab, ConsortiumTab])

  if (!open) return null

  return (
    <div className={styles.panel} style={{ height: `${height}px` }}>
      <ResizeHandle />
      <div className={styles.tabBar} role="tablist" aria-label={t('canvas.bottomPanel.ariaLabel')}>
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
            onClick={() => setBottomPanelTab(tab)}
          >
            {getTabLabel(tab)}
          </button>
        ))}
        <div className={styles.tabBarSpacer} />
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={() => setBottomPanelOpen(false)}
          aria-label={t('canvas.bottomPanel.collapse')}
        >
          {t('canvas.bottomPanel.collapse')}
        </button>
      </div>

      <div className={styles.tabContent}>
        {activeTab === 'location' && (LocationTab ? <LocationTab /> : <LoadingState />)}
        {activeTab === 'consortium' && (ConsortiumTab ? <ConsortiumTab /> : <LoadingState />)}
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
          const maxHeight = Math.max(200, window.innerHeight * 0.55)
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

function LoadingState() {
  return <div className={styles.tabPlaceholder}>{t('plantDb.loading')}</div>
}
