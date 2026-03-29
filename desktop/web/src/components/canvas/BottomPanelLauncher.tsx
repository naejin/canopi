import { t } from '../../i18n'
import { locale } from '../../state/app'
import { bottomPanelTab, type BottomPanelTab } from '../../state/canvas'
import { openBottomPanel } from '../../state/canvas-actions'
import styles from './BottomPanelLauncher.module.css'

const TABS: BottomPanelTab[] = ['location', 'timeline', 'budget', 'consortium']

function getLabel(tab: BottomPanelTab): string {
  if (tab === 'location') return t('canvas.location.title')
  if (tab === 'consortium') return t('canvas.bottomPanel.consortium')
  return t(`canvas.bottomPanel.${tab}`)
}

export function BottomPanelLauncher() {
  void locale.value

  const activeTab = bottomPanelTab.value

  return (
    <div className={styles.launcher} role="tablist" aria-label={t('canvas.bottomPanel.ariaLabel')}>
      {TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={activeTab === tab}
          className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
          onClick={() => openBottomPanel(tab)}
        >
          {getLabel(tab)}
        </button>
      ))}
    </div>
  )
}
