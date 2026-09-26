import { createPortal } from 'preact/compat'
import { useEffect, useRef } from 'preact/hooks'
import type {
  CanvasCommandProjection,
  CanvasProjectedCommand,
} from '../../app/canvas-commands'
import { plantColorMenuOpen } from '../../canvas/plant-color-menu-state'
import { plantSymbolMenuOpen } from '../../canvas/plant-symbol-menu-state'
import { currentCanvasQuerySurface, currentCanvasSelection } from '../../canvas/session'
import { t } from '../../i18n'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import { PlantColorMenu } from './PlantColorMenu'
import { PlantSymbolMenu } from './PlantSymbolMenu'
import { PaletteIcon, PlantSymbolIcon, ToolIcon, type ToolIconName } from './toolbar-icons'
import styles from './ToolRail.module.css'

interface ToolRailProps {
  readonly projection: CanvasCommandProjection
  /** Names and keys beside each tool (first use, or View › Tool names). */
  readonly showNames: boolean
}

/**
 * The floating tool rail on the left: Select, Pan · Place plants, Plant a
 * row, Place a stamp · Zones · Text note, Measure · Undo, Redo. The active
 * tool is pressed; arrow keys move between buttons (roving tabindex).
 */
export function ToolRail({ projection, showNames }: ToolRailProps) {
  const rail = useRef<HTMLDivElement>(null)
  const tools = projection.toolGroups.flatMap((group) => group.tools)
  const focusTarget = tools.find((command) => command.active)?.commandId ?? tools[0]?.commandId

  function handleKeyDown(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(rail.current?.querySelectorAll<HTMLButtonElement>('[data-rail-item]') ?? [])
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons.forEach((button, buttonIndex) => { button.tabIndex = buttonIndex === next ? 0 : -1 })
    buttons[next]?.focus()
  }

  function renderCommand(command: CanvasProjectedCommand, icon: ToolIconName, pressed?: boolean) {
    const tabIndex = command.commandId === focusTarget ? 0 : -1
    return (
      <button
        key={command.commandId}
        type="button"
        className={styles.button}
        data-rail-item
        data-command={command.commandId}
        aria-label={showNames ? undefined : command.shortcut ? `${command.label} (${command.shortcut})` : command.label}
        aria-pressed={pressed}
        aria-keyshortcuts={command.ariaShortcut}
        aria-disabled={command.disabled ? true : undefined}
        tabIndex={tabIndex}
        onClick={() => { if (!command.disabled) command.action() }}
      >
        <ToolIcon name={icon} className={styles.icon} />
        {showNames ? (
          <>
            <span className={styles.label}>{command.label}</span>
            {command.shortcut && <kbd className={styles.key} aria-hidden="true">{command.shortcut}</kbd>}
          </>
        ) : (
          <ButtonTooltip label={command.label} shortcut={command.shortcut} />
        )}
      </button>
    )
  }

  return (
    <div
      ref={rail}
      role="toolbar"
      aria-label={t('canvas.toolbar')}
      aria-orientation="vertical"
      className={`${styles.rail} ${showNames ? styles.named : styles.icons}`}
      data-tool-rail={showNames ? 'named' : 'icons'}
      onKeyDown={handleKeyDown}
    >
      {projection.toolGroups.map((group, index) => (
        <div key={group.id} className={styles.group} role="group" aria-label={group.heading}>
          {index > 0 && <div className={styles.rule} role="separator" />}
          {showNames && group.heading && <span className={styles.heading} aria-hidden="true">{group.heading}</span>}
          {group.tools.map((command) => renderCommand(command, command.tool, command.active))}
        </div>
      ))}
      <div className={styles.group}>
        <div className={styles.rule} role="separator" />
        {projection.historyActions.map((command) => renderCommand(command, command.id as ToolIconName))}
      </div>
      <PlantAppearanceTools showNames={showNames} />
    </div>
  )
}

/**
 * Symbol and colour for selected plants. They stay on the rail, shown only
 * while plants are selected, until the right-click menu carries them.
 */
function PlantAppearanceTools({ showNames }: { readonly showNames: boolean }) {
  void currentCanvasSelection.value
  const querySurface = currentCanvasQuerySurface.value
  const colorButton = useRef<HTMLButtonElement>(null)
  const symbolButton = useRef<HTMLButtonElement>(null)
  const hasSelectedPlants = (querySurface?.getSelectedPlantColorContext().plantIds.length ?? 0) > 0

  // The popovers act on the selected plants; they close when none remain.
  useEffect(() => {
    if (hasSelectedPlants) return
    plantColorMenuOpen.value = false
    plantSymbolMenuOpen.value = false
  }, [hasSelectedPlants])

  if (!hasSelectedPlants) return null
  const colorLabel = t('canvas.plantColor.label')
  const symbolLabel = t('canvas.plantSymbol.label')
  return (
    <div className={`${styles.group} ${styles.popoverAnchor}`} data-preserve-overlays="true">
      <div className={styles.rule} role="separator" />
      <button
        ref={colorButton}
        type="button"
        className={styles.button}
        data-rail-item
        aria-label={showNames ? undefined : colorLabel}
        aria-pressed={plantColorMenuOpen.value}
        tabIndex={-1}
        onClick={() => {
          plantSymbolMenuOpen.value = false
          plantColorMenuOpen.value = !plantColorMenuOpen.value
        }}
      >
        <PaletteIcon className={styles.icon} />
        {showNames ? <span className={styles.label}>{colorLabel}</span> : <ButtonTooltip label={colorLabel} />}
      </button>
      {/* Portalled: the rail's backdrop blur would otherwise contain the fixed popover. */}
      {plantColorMenuOpen.value && createPortal(<PlantColorMenu buttonRef={colorButton} />, document.body)}
      <button
        ref={symbolButton}
        type="button"
        className={styles.button}
        data-rail-item
        aria-label={showNames ? undefined : symbolLabel}
        aria-pressed={plantSymbolMenuOpen.value}
        tabIndex={-1}
        onClick={() => {
          plantColorMenuOpen.value = false
          plantSymbolMenuOpen.value = !plantSymbolMenuOpen.value
        }}
      >
        <PlantSymbolIcon className={styles.icon} />
        {showNames ? <span className={styles.label}>{symbolLabel}</span> : <ButtonTooltip label={symbolLabel} />}
      </button>
      {plantSymbolMenuOpen.value && createPortal(<PlantSymbolMenu buttonRef={symbolButton} />, document.body)}
    </div>
  )
}
