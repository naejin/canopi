import { t } from '../../i18n'
import { locale } from '../../state/app'
import { bottomPanelOpen, bottomPanelTab, type BottomPanelTab } from '../../state/canvas'
import { openBottomPanel, setBottomPanelOpen } from '../../state/canvas-actions'
import styles from './BottomPanelLauncher.module.css'

const TABS: BottomPanelTab[] = ['location']

function getLabel(_tab: BottomPanelTab): string {
  return t('canvas.location.title')
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
      {TABS.map((tab) => (
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
