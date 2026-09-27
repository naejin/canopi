import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type {
  CanvasCommandProjection,
  CanvasProjectedCommand,
  CanvasToolbarToolCommand,
} from '../../app/canvas-commands'
import { toolRailRoom, visibleMapFrame } from '../../app/shell/visible-map-area'
import { t } from '../../i18n'
import { ActionMenu } from '../shared/ActionMenu'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import { railVisibleCount } from '../shared/rail-fit'
import { ToolIcon, type ToolIconName } from './toolbar-icons'
import { useRail } from '../shared/useMapChrome'
import styles from './ToolRail.module.css'

interface ToolRailProps {
  readonly projection: CanvasCommandProjection
  /** Names and keys beside each tool (first use, or View › Tool names). */
  readonly showNames: boolean
}

/**
 * The floating tool rail on the left: Select, Pan · Place plants, Plant a
 * row, Place a stamp · Zones · Text note, Measure · Undo, Redo. The active
 * tool is pressed; arrow keys move between buttons (roving tabindex). When a
 * short window leaves too little room above the view chip (`toolRailRoom`),
 * the last tools fold, in order, into a More tools menu just before Undo and
 * Redo, which always stay on the rail.
 */
export function ToolRail({ projection, showNames: namesWanted }: ToolRailProps) {
  const rail = useRef<HTMLDivElement>(null)
  useRail(rail, 'tool')
  const tools = projection.toolGroups.flatMap((group) => group.tools)

  // A name cut off in the fixed-width labelled rail (a long German or Russian
  // label) is no name: the rail keeps to icons with labelled tooltips until
  // the labels or the map width change.
  const labelsKey = `${visibleMapFrame.value.width}|${[...tools, ...projection.historyActions].map((command) => `${command.label} ${command.shortcut ?? ''}`).join('|')}`
  const [cutKey, setCutKey] = useState<string | null>(null)
  const showNames = namesWanted && cutKey !== labelsKey
  useLayoutEffect(() => {
    const element = rail.current
    if (!showNames || !element) return
    const cut = Array.from(element.querySelectorAll<HTMLElement>('[data-rail-label]'))
      .some((label) => label.scrollWidth > label.clientWidth + 1)
    if (cut) setCutKey(labelsKey)
  })

  const room = toolRailRoom.value
  const layoutKey = `${room}|${showNames}|${projection.toolGroups.map((group) => group.tools.map((tool) => tool.tool).join(',')).join('|')}`
  const [fit, setFit] = useState<{ readonly key: string; readonly count: number | null }>({ key: '', count: null })
  // A new room, mode or tool list first lays every tool out to measure it.
  const measuring = fit.key !== layoutKey
  useLayoutEffect(() => {
    const element = rail.current
    if (!measuring || !element) return
    const top = element.getBoundingClientRect()
    const buttons = Array.from(element.querySelectorAll<HTMLElement>('[data-rail-tool]'), (button) => {
      const box = button.getBoundingClientRect()
      return { top: box.top - top.top, bottom: box.bottom - top.top }
    })
    setFit({ key: layoutKey, count: railVisibleCount(buttons, top.height, room) })
  })
  const shown = measuring ? null : fit.count
  const folded = shown === null ? [] : tools.slice(shown)
  let remaining = shown ?? Infinity
  const railGroups = projection.toolGroups.map((group) => {
    const kept = group.tools.slice(0, Math.max(0, remaining))
    remaining -= kept.length
    return { ...group, tools: kept }
  }).filter((group) => group.tools.length > 0)

  const railCommands: string[] = [
    ...railGroups.flatMap((group) => group.tools.map((tool) => tool.commandId)),
    ...(folded.length > 0 ? [MORE_ID] : []),
    ...projection.historyActions.map((command) => command.commandId),
  ]
  const active = tools.find((command) => command.active)
  const focusTarget = active && folded.includes(active) ? MORE_ID : active?.commandId ?? railCommands[0]

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
        data-rail-tool={pressed === undefined ? undefined : ''}
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
            <span className={styles.label} data-rail-label>{command.label}</span>
            {command.shortcut && <kbd className={styles.key} aria-hidden="true">{command.shortcut}</kbd>}
          </>
        ) : (
          <ButtonTooltip label={command.label} shortcut={command.shortcut} />
        )}
      </button>
    )
  }

  const moreLabel = t('canvas.toolbarMore')
  const more = folded.length > 0 && (
    <ActionMenu
      label={moreLabel}
      placement="side"
      openKey="ArrowRight"
      tooltipSide="right"
      tabIndex={focusTarget === MORE_ID ? 0 : -1}
      triggerClassName={styles.button}
      iconSize={20}
      triggerLabel={showNames ? <span className={styles.label} data-rail-label>{moreLabel}</span> : undefined}
      triggerData={{
        'data-rail-item': '',
        'data-tool-rail-more': '',
        'data-holds-active': active && folded.includes(active) ? '' : undefined,
      }}
      items={folded.map((command: CanvasToolbarToolCommand) => ({
        id: command.commandId,
        label: command.label,
        shortcut: command.shortcut,
        keyShortcuts: command.ariaShortcut,
        checked: command.active,
        disabled: command.disabled,
        run: () => command.action(),
      }))}
    />
  )

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
      {railGroups.map((group, index) => (
        <div key={group.id} className={styles.group} role="group" aria-label={group.heading}>
          {index > 0 && <div className={styles.rule} role="separator" />}
          {showNames && group.heading && <span className={styles.heading} aria-hidden="true">{group.heading}</span>}
          {group.tools.map((command) => renderCommand(command, command.tool, command.active))}
          {index === railGroups.length - 1 && more}
        </div>
      ))}
      {railGroups.length === 0 && more}
      <div className={styles.group}>
        <div className={styles.rule} role="separator" />
        {projection.historyActions.map((command) => renderCommand(command, command.id as ToolIconName))}
      </div>
    </div>
  )
}

/** The More tools button's place in the roving tab order. */
const MORE_ID = 'tool-rail.more'
