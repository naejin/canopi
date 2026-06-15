import { appCommandGraphPanelProjection, type AppCommandGraphPanelCommand } from '../../commands/registry'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import styles from './PanelBar.module.css'

const PANEL_ICON_STROKE_WIDTH = 1.5

const panelIcons: Record<AppCommandGraphPanelCommand['panel'], () => preact.JSX.Element> = {
  canvas: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={PANEL_ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    </svg>
  ),
  location: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={PANEL_ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a11 11 0 0 1 0 16" />
      <path d="M12 4a11 11 0 0 0 0 16" />
      <path d="M4 12h16" />
    </svg>
  ),
  'plant-db': () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={PANEL_ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </svg>
  ),
  favorites: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={PANEL_ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
}

export function PanelBar() {
  const projection = appCommandGraphPanelProjection.value

  function renderPanelButton(command: AppCommandGraphPanelCommand) {
    const Icon = panelIcons[command.panel]
    return (
      <button
        key={command.panel}
        type="button"
        className={styles.button}
        onClick={command.action}
        disabled={command.disabled}
        aria-label={command.label}
        aria-pressed={command.active}
      >
        <Icon />
        <ButtonTooltip label={command.label} side="left" />
      </button>
    )
  }

  return (
    <nav className={styles.bar} aria-label="Panels">
      {projection.primary.map(renderPanelButton)}

      <div className={styles.divider} aria-hidden="true" />

      {projection.side.map(renderPanelButton)}
    </nav>
  )
}
