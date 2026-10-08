import { ActionMenu } from './ActionMenu'
import { storyPresentationActive } from '../../app/story-presentation'
import { ButtonTooltip } from './ButtonTooltip'
import { PanelIcon, type PanelIconName } from './PanelIcon'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { panelRailRoom } from '../../app/shell/visible-map-area'
import { t } from '../../i18n'
import { useRail } from './useMapChrome'
import { useModalInertRegion } from './useModalLayer'
import { railVisibleCount } from './rail-fit'
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
 * The floating panel rail on the right (Ctrl 1–9): one button per panel,
 * groups separated by rules. Only one panel is open at a time. When the window
 * is too short for every panel above the chrome under the rail's column
 * (`panelRailRoom`), the last panels fold, in order, into a More menu at the
 * rail's end, so Tab still meets them in rail order.
 */
export function PanelRail(props: {
  readonly groups: readonly (readonly PanelRailCommand[])[]
  readonly label: string
  /** The rail belongs to the open Design (Desktop): it waits with the Design's chrome while the Design is hidden. */
  readonly designChrome?: boolean
}) {
  // A presented story fills the window: the rail steps aside until it ends.
  return storyPresentationActive.value ? null : <PanelRailContent {...props} />
}

function PanelRailContent({ groups, label, designChrome = false }: {
  readonly groups: readonly (readonly PanelRailCommand[])[]
  readonly label: string
  readonly designChrome?: boolean
}) {
  const visibleGroups = groups
    .map((group) => group.filter((command) => command.panel))
    .filter((group) => group.length > 0)
  const rail = useRef<HTMLElement>(null)
  useRail(rail, 'panel')
  useModalInertRegion(rail)

  const room = panelRailRoom.value
  const layoutKey = `${room}|${visibleGroups.map((group) => group.map((command) => command.panel).join(',')).join('|')}`
  const [fit, setFit] = useState<{ readonly key: string; readonly count: number | null }>({ key: '', count: null })
  // A new room or panel list first lays every panel out to measure it.
  const measuring = fit.key !== layoutKey
  useLayoutEffect(() => {
    const nav = rail.current
    if (!measuring || !nav) return
    const top = nav.getBoundingClientRect()
    const buttons = Array.from(nav.querySelectorAll<HTMLElement>('[data-panel]'), (button) => {
      const box = button.getBoundingClientRect()
      return { top: box.top - top.top, bottom: box.bottom - top.top }
    })
    setFit({ key: layoutKey, count: railVisibleCount(buttons, top.height, room) })
  })

  const shown = measuring ? null : fit.count
  let remaining = shown ?? Infinity
  const railGroups = visibleGroups
    .map((group) => {
      const kept = group.slice(0, Math.max(0, remaining))
      remaining -= kept.length
      return kept
    })
  const folded = shown === null ? [] : visibleGroups.flat().slice(shown)
  // More ends the last group that keeps a panel, or stands alone.
  const lastKept = railGroups.reduce((last, group, index) => group.length > 0 ? index : last, -1)
  const more = folded.length > 0 && (
    <ActionMenu
      label={t('panelRail.more')}
      placement="side"
      triggerClassName={styles.button}
      iconSize={20}
      triggerData={{
        'data-panel-rail-more': '',
        'data-holds-active': folded.some((command) => command.active) ? '' : undefined,
      }}
      items={folded.map((command) => ({
        id: command.id ?? command.commandId,
        label: command.label,
        shortcut: command.shortcut,
        keyShortcuts: command.ariaShortcut,
        checked: command.active ?? false,
        disabled: command.disabled,
        run: () => command.action(),
      }))}
    />
  )

  return (
    <nav ref={rail} className={styles.rail} aria-label={label} data-panel-rail data-design-chrome={designChrome ? '' : undefined}>
      {railGroups.map((group, index) => (group.length > 0 || (index === 0 && lastKept < 0 && more)) && (
        <div key={index} className={styles.group}>
          {index > 0 && group.length > 0 && <div className={styles.rule} role="separator" />}
          {group.map((command) => (
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
              <PanelIcon panel={command.panel!} />
              <ButtonTooltip label={command.label} shortcut={command.shortcut} side="left" />
            </button>
          ))}
          {(index === lastKept || (lastKept < 0 && index === 0)) && more}
        </div>
      ))}
    </nav>
  )
}
