import { useRef, useCallback } from 'preact/hooks'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { bottomPanelOpen, bottomPanelTab, bottomPanelHeight } from '../../state/canvas'
import { TimelineTab } from './TimelineTab'
import { ConsortiumTab } from './ConsortiumTab'
import { BudgetTab } from './BudgetTab'
import styles from './BottomPanel.module.css'

const TABS = ['timeline', 'consortium', 'budget'] as const
type BottomTab = typeof TABS[number]

export function BottomPanel() {
  void locale.value

  const panelRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = bottomPanelHeight.value

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startY - e.clientY
      const newHeight = Math.max(120, Math.min(window.innerHeight * 0.6, startHeight + delta))
      bottomPanelHeight.value = newHeight
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'row-resize'
  }, [])

  if (!bottomPanelOpen.value) return null

  const activeTab = bottomPanelTab.value

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      style={{ height: `${bottomPanelHeight.value}px` }}
    >
      <div
        className={styles.resizeHandle}
        onMouseDown={handleMouseDown}
        aria-hidden="true"
      />
      <div className={styles.tabBar} role="tablist" aria-label={t('canvas.bottomPanel.ariaLabel')}>
        {TABS.map((tab: BottomTab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`bottom-tabpanel-${tab}`}
            id={`bottom-tab-${tab}`}
            className={`${styles.tab}${activeTab === tab ? ` ${styles.tabActive}` : ''}`}
            onClick={() => { bottomPanelTab.value = tab }}
          >
            {t(`canvas.bottomPanel.${tab}`)}
          </button>
        ))}
        <div className={styles.tabBarSpacer} aria-hidden="true" />
        <button
          className={styles.collapseBtn}
          onClick={() => { bottomPanelOpen.value = false }}
          aria-label={t('canvas.bottomPanel.collapse')}
          type="button"
        >
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="12" height="12">
            <path d="M3 5L8 10L13 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
      <div
        className={styles.tabContent}
        role="tabpanel"
        id={`bottom-tabpanel-${activeTab}`}
        aria-labelledby={`bottom-tab-${activeTab}`}
      >
        {activeTab === 'timeline' && <TimelineTab />}
        {activeTab === 'consortium' && <ConsortiumTab />}
        {activeTab === 'budget' && <BudgetTab />}
      </div>
    </div>
  )
}
