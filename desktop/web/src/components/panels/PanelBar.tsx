import { activePanel, sidePanel, navigateTo, type Panel } from '../../app/shell/state'
import { currentDesign } from '../../app/document-session/store'
import { locale } from '../../app/settings/state'
import { t } from '../../i18n'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import styles from './PanelBar.module.css'

interface PanelItem {
  id: Panel
  labelKey: string
  icon: () => preact.JSX.Element
}

const primaryPanels: PanelItem[] = [
  {
    id: 'canvas',
    labelKey: 'nav.canvas',
    icon: () => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      </svg>
    ),
  },
  {
    id: 'location',
    labelKey: 'canvas.location.title',
    icon: () => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4a11 11 0 0 1 0 16" />
        <path d="M12 4a11 11 0 0 0 0 16" />
        <path d="M4 12h16" />
      </svg>
    ),
  },
]

const sidePanels: PanelItem[] = [
  {
    id: 'plant-db',
    labelKey: 'nav.plantDb',
    icon: () => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 2 8 0 5.5-4.78 10-10 10Z" />
        <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
      </svg>
    ),
  },
  {
    id: 'favorites',
    labelKey: 'nav.favorites',
    icon: () => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
]

export function PanelBar() {
  void locale.value

  const active = activePanel.value
  const activeSidePanel = sidePanel.value
  const hasDesign = currentDesign.value !== null

  function isActive(panel: Panel): boolean {
    if (panel === 'canvas') {
      return active === 'canvas' && activeSidePanel === null
    }
    if (panel === 'location') {
      return active === 'location'
    }
    return active === 'canvas' && activeSidePanel === panel
  }

  function renderPanelButton(panel: PanelItem, disabled: boolean) {
    const label = t(panel.labelKey)

    return (
      <button
        key={panel.id}
        type="button"
        className={styles.button}
        onClick={() => navigateTo(panel.id)}
        disabled={disabled}
        aria-label={label}
        aria-pressed={isActive(panel.id)}
      >
        <panel.icon />
        <ButtonTooltip label={label} side="left" />
      </button>
    )
  }

  return (
    <nav className={styles.bar} aria-label="Panels">
      {primaryPanels.map((p) => renderPanelButton(p, p.id === 'location' && !hasDesign))}

      <div className={styles.divider} aria-hidden="true" />

      {sidePanels.map((p) => renderPanelButton(p, !hasDesign))}
    </nav>
  )
}
