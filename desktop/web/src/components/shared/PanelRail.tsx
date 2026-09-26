import { ButtonTooltip } from './ButtonTooltip'
import { PanelIcon, type PanelIconName } from './PanelIcon'
import styles from './PanelRail.module.css'

/** One panel entry as the command projection hands it over. */
export interface PanelRailCommand {
  readonly panel?: PanelIconName
  /** The command identity, exposed as `data-command-id`. */
  readonly id?: string
  readonly commandId?: string
  readonly label: string
  readonly shortcut?: string
  readonly ariaShortcut?: string
  readonly disabled: boolean
  readonly active?: boolean
  action(): void
}

/**
 * The floating panel rail on the right (Ctrl 1–8): one button per panel,
 * groups separated by rules. Only one panel is open at a time.
 */
export function PanelRail({ groups, label }: {
  readonly groups: readonly (readonly PanelRailCommand[])[]
  readonly label: string
}) {
  const visibleGroups = groups.filter((group) => group.length > 0)
  return (
    <nav className={styles.rail} aria-label={label} data-panel-rail>
      {visibleGroups.map((group, index) => (
        <div key={index} className={styles.group}>
          {index > 0 && <div className={styles.rule} role="separator" />}
          {group.map((command) => command.panel && (
            <button
              key={command.panel}
              type="button"
              className={styles.button}
              data-panel={command.panel}
              data-command-id={command.id ?? command.commandId}
              aria-label={command.label}
              aria-expanded={command.active ?? false}
              aria-keyshortcuts={command.ariaShortcut}
              disabled={command.disabled}
              onClick={() => command.action()}
            >
              <PanelIcon panel={command.panel} />
              <ButtonTooltip label={command.label} shortcut={command.shortcut} side="left" />
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}
