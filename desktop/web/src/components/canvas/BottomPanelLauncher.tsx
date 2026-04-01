import { t } from '../../i18n'
import { locale } from '../../state/app'
import {
  bottomPanelOpen,
  bottomPanelTab,
  type BottomPanelTab,
  VISIBLE_BOTTOM_PANEL_TABS,
} from '../../state/canvas'
import { openBottomPanel, setBottomPanelOpen } from '../../state/canvas-actions'
import styles from './BottomPanelLauncher.module.css'

function getLabel(tab: BottomPanelTab): string {
  switch (tab) {
    case 'location':
      return t('canvas.location.title')
    case 'timeline':
      return t('canvas.bottomPanel.timeline')
    case 'budget':
      return t('canvas.bottomPanel.budget')
    case 'consortium':
      return t('canvas.bottomPanel.consortium')
  }
}

export function BottomPanelLauncher() {
  void locale.value

  const isOpen = bottomPanelOpen.value
  const activeTab = bottomPanelTab.value

  function handleClick(tab: BottomPanelTab) {
    if (isOpen && activeTab === tab) {
      setBottomPanelOpen(false)
    } else {
      openBottomPanel(tab)
    }
  }

  return (
    <div className={styles.launcher} role="tablist" aria-label={t('canvas.bottomPanel.ariaLabel')}>
      {VISIBLE_BOTTOM_PANEL_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={isOpen && activeTab === tab}
          className={`${styles.tab} ${isOpen && activeTab === tab ? styles.tabOpen : ''}`}
          onClick={() => handleClick(tab)}
        >
          {getLabel(tab)}
        </button>
      ))}
    </div>
  )
}
