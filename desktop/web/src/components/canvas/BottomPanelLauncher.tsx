import { t } from '../../i18n'
import { locale } from '../../app/shell/state'
import { type BottomPanelTab } from '../../state/canvas'
import { openBottomPanel, setBottomPanelOpen } from '../../app/canvas-settings/controller'
import { bottomPanelView } from '../../app/canvas-settings/state'
import styles from './BottomPanelLauncher.module.css'

function getLabel(tab: BottomPanelTab): string {
  switch (tab) {
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

  const { open: isOpen, tab: activeTab, visibleTabs } = bottomPanelView.value

  function handleClick(tab: BottomPanelTab) {
    if (isOpen && activeTab === tab) {
      setBottomPanelOpen(false)
    } else {
      openBottomPanel(tab)
    }
  }

  return (
    <div className={styles.launcher} role="tablist" aria-label={t('canvas.bottomPanel.ariaLabel')}>
      {visibleTabs.map((tab) => (
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
