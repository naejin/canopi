import { PanelIcon } from '../shared/PanelIcon'
import { appCommandGraphPanelProjection, type AppCommandGraphPanelCommand } from '../../commands/registry'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import styles from './PanelBar.module.css'

export function PanelBar() {
  const projection = appCommandGraphPanelProjection.value

  function renderPanelButton(command: AppCommandGraphPanelCommand) {
    return (
      <button
        key={command.panel}
        data-panel={command.panel}
        type="button"
        className={styles.button}
        onClick={command.action}
        disabled={command.disabled}
        aria-label={command.label}
        aria-pressed={command.active}
      >
        <PanelIcon panel={command.panel} />
        <ButtonTooltip label={command.label} side="left" />
      </button>
    )
  }

  return (
    <nav className={styles.bar} aria-label="Panels">
      {projection.primary.map(renderPanelButton)}

      <div className={styles.divider} aria-hidden="true" />

      {projection.design.map(renderPanelButton)}
      <div className={styles.divider} aria-hidden="true" />
      {projection.side.map(renderPanelButton)}
    </nav>
  )
}
