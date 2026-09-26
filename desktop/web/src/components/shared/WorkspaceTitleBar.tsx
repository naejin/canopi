import type { ComponentChildren } from 'preact'
import type { MenuDefinition } from '../../app/shell-commands/menus'
import { t } from '../../i18n'
import { ButtonTooltip } from './ButtonTooltip'
import { ControlIcon, type ControlIconName } from './ControlIcon'
import { MenuBar } from './MenuBar'
import styles from './WorkspaceTitleBar.module.css'

/** A title-bar command button: label, shortcut and action come from the command projection. */
export interface TitleBarCommand {
  readonly label: string
  readonly shortcut?: string
  readonly ariaShortcut?: string
  readonly disabled?: boolean
  action(): void
}

interface WorkspaceTitleBarProps {
  readonly menus: readonly MenuDefinition[]
  readonly onMenuOpen?: (menuId: string) => void
  /** Design name field and save status; absent on the start screen. */
  readonly design?: ComponentChildren
  /** Edition file actions before the search field (Web: Open a .canopi file). */
  readonly fileActions?: ComponentChildren
  readonly search?: ComponentChildren
  readonly help: TitleBarCommand
  readonly settings: TitleBarCommand
  /** Desktop window controls; the frameless window draws its own. */
  readonly windowControls?: ComponentChildren
  readonly onMouseDown?: (event: MouseEvent) => void
}

/**
 * The floating title bar both editions share: logo, menu bar, Design name
 * with its save status, place search, Help and Settings.
 */
export function WorkspaceTitleBar({
  menus,
  onMenuOpen,
  design,
  fileActions,
  search,
  help,
  settings,
  windowControls,
  onMouseDown,
}: WorkspaceTitleBarProps) {
  return (
    <header className={styles.titleBar} onMouseDown={onMouseDown} data-workspace-title-bar>
      <img
        src={new URL('../../assets/canopi-logo.svg', import.meta.url).href}
        className={styles.logo}
        alt="Canopi"
        draggable={false}
      />
      <MenuBar menus={menus} label={t('titleBar.menus')} onMenuOpen={onMenuOpen} />
      {design && (
        <>
          <span className={styles.rule} aria-hidden="true" />
          <div className={styles.design}>{design}</div>
        </>
      )}
      <span className={styles.spacer} />
      {fileActions}
      {search}
      <TitleBarIconButton command={help} icon="help" />
      <TitleBarIconButton command={settings} icon="gear" />
      {windowControls && (
        <>
          <span className={styles.rule} aria-hidden="true" />
          {windowControls}
        </>
      )}
    </header>
  )
}

export function TitleBarIconButton({ command, icon }: {
  readonly command: TitleBarCommand
  readonly icon: ControlIconName
}) {
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label={command.label}
      aria-keyshortcuts={command.ariaShortcut}
      aria-disabled={command.disabled ? true : undefined}
      onClick={() => { if (!command.disabled) command.action() }}
    >
      <ControlIcon name={icon} size={20} />
      <ButtonTooltip label={command.label} shortcut={command.shortcut} side="bottom" />
    </button>
  )
}
