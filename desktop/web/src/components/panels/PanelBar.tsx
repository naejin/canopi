import { sidePanel, navigateTo, type Panel } from '../../state/app'
import { t } from '../../i18n'
import styles from './PanelBar.module.css'

interface PanelItem {
  id: Panel
  labelKey: string
  icon: () => preact.JSX.Element
}

const panels: PanelItem[] = [
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
    id: 'world-map',
    labelKey: 'nav.worldMap',
    icon: () => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8" />
        <path d="M4 12h16" />
        <path d="M12 4a12 12 0 0 1 0 16" />
        <path d="M12 4a12 12 0 0 0 0 16" />
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
  const active = sidePanel.value

  return (
    <nav className={styles.bar} aria-label="Panels">
      {panels.map((p) => {
        const isActive = active === p.id
        const label = t(p.labelKey)

        return (
          <button
            key={p.id}
            className={`${styles.button} ${isActive ? styles.active : ''}`}
            onClick={() => navigateTo(p.id)}
            title={label}
            aria-label={label}
            aria-pressed={isActive}
          >
            <p.icon />
          </button>
        )
      })}
    </nav>
  )
}
