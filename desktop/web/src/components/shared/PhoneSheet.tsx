import type { ComponentChildren } from 'preact'
import { useId, useRef } from 'preact/hooks'
import {
  cyclePhoneSheet,
  phoneSheetOpenHeight,
  snapPhoneSheet,
  stepPhoneSheet,
  type PhoneLayout,
  type PhoneSheetHeight,
} from '../../app/shell/phone-layout'
import { isSidePanel } from '../../app/shell/state'
import { visibleMapFrame } from '../../app/shell/visible-map-area'
import { t } from '../../i18n'
import { ActionMenu } from './ActionMenu'
import type { PanelRailCommand } from './PanelRail'
import { useFocusRegion } from './useFocusRegion'
import { useMapOccluder, useUnderRail } from './useMapChrome'
import { usePointerResize } from './usePointerResize'
import styles from './PhoneSheet.module.css'

/** Panel tabs shown before More; the rest wait in More, in order. */
export const PHONE_SHEET_TABS = 3
/** A handle press that moves less than this (CSS px) is a tap, not a drag. */
const DRAG_SLOP_PX = 6
/** The gap between the top bar and a full sheet, as `--chrome-rail-top` leaves it. */
const FULL_GAP_PX = 8

interface SheetDrag {
  readonly sheet: HTMLElement
  readonly startY: number
  readonly startSize: number
  readonly startTime: number
  readonly stops: Readonly<Record<PhoneSheetHeight, number>>
  size: number
}

/**
 * The Web Edition's panels on a phone (board WebPhone): a sheet at the bottom
 * in portrait, at the right in landscape (resting in the bottom right corner),
 * in place of the floating dock and panel rail. It rests at peek (the handle and the panel tabs) while no panel
 * is open, and opens a panel at half height or all the way up to the top bar.
 * The handle is a 44 px button: a press steps peek → half → full → peek,
 * ArrowUp and ArrowDown (PageUp, PageDown, Home, End) move between the
 * heights, and in portrait a drag lets go at the nearest one. Resting at peek
 * closes the open panel; raising the sheet with none open opens the first
 * tab. The sheet covers the map's bottom (or right) edge in the visible map
 * area, so fitting, chips and cards keep above it.
 */
export function PhoneSheet({ layout, tabs, children }: {
  readonly layout: PhoneLayout
  /**
   * The panel commands, in rail order; the first `PHONE_SHEET_TABS` show as
   * tabs and the rest wait in More under their full names.
   */
  readonly tabs: readonly PanelRailCommand[]
  /** The open panel, when there is one. */
  readonly children?: ComponentChildren
}) {
  const sheet = useRef<HTMLElement>(null)
  const handle = useRef<HTMLButtonElement>(null)
  // Set by a drag, so the click that ends it is not taken for a press.
  const dragged = useRef(false)
  const panelId = useId()
  const portrait = layout === 'portrait'
  const panels = tabs.filter((command) => command.panel)
  // Only side panels open the sheet; a primary view (Templates) just switches the map.
  const sidePanels = panels.filter((command) => isSidePanel(command.panel!))
  const open = sidePanels.some((command) => command.active)
  const height: PhoneSheetHeight = open && children ? phoneSheetOpenHeight.value : 'peek'
  // On its side the sheet rests in the bottom right corner and opens along the right edge.
  useMapOccluder(sheet, portrait || height === 'peek' ? 'bottom' : 'right')
  // The tool strip ends above the sheet rather than behind it.
  useUnderRail(sheet, 'tool', portrait)
  useFocusRegion(sheet, 'dock')

  function moveTo(next: PhoneSheetHeight): void {
    if (next === 'peek') {
      sidePanels.find((command) => command.active)?.action()
      return
    }
    phoneSheetOpenHeight.value = next
    if (!open) sidePanels.find((command) => !command.disabled)?.action()
  }

  const onPointerDown = usePointerResize<SheetDrag>({
    cursor: 'row-resize',
    begin: (event) => {
      dragged.current = false
      const element = sheet.current
      const host = element?.offsetParent
      if (!portrait || !element || !(host instanceof HTMLElement)) return null
      const box = element.getBoundingClientRect()
      const hostBox = host.getBoundingClientRect()
      const peek = (handle.current?.offsetHeight ?? 0) + (element.querySelector<HTMLElement>('[role="tablist"]')?.offsetHeight ?? 0)
      return {
        sheet: element,
        startY: event.clientY,
        startSize: box.height,
        startTime: event.timeStamp,
        // Full rests just below the top bar, which the visible map frame measures.
        stops: { peek, half: hostBox.height / 2, full: box.bottom - hostBox.top - visibleMapFrame.peek().top - FULL_GAP_PX },
        size: box.height,
      }
    },
    preview: (session, event) => {
      const moved = session.startY - event.clientY
      if (Math.abs(moved) < DRAG_SLOP_PX) return false
      session.size = Math.max(session.stops.peek, Math.min(session.stops.full, session.startSize + moved))
      session.sheet.style.height = `${session.size}px`
      session.sheet.dataset.dragging = 'true'
      return true
    },
    commit: (session, event) => {
      release(session.sheet)
      dragged.current = true
      const elapsed = Math.max(1, event.timeStamp - session.startTime)
      moveTo(snapPhoneSheet(session.size, session.stops, (session.size - session.startSize) / elapsed))
    },
    rollback: (session) => release(session.sheet),
  })

  const shown = panels.slice(0, PHONE_SHEET_TABS)
  const folded = panels.slice(PHONE_SHEET_TABS)
  const handleLabel = height === 'peek' ? t('webPhone.sheetShow')
    : height === 'half' ? t('webPhone.sheetExpand')
      : t('webPhone.sheetHide')

  function onTabKeyDown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(sheet.current?.querySelectorAll<HTMLElement>('[data-sheet-tab]') ?? [])
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
    items.forEach((item, itemIndex) => { item.tabIndex = itemIndex === next ? 0 : -1 })
    items[next]?.focus()
  }

  const focusIndex = Math.max(0, shown.findIndex((command) => command.active))

  return (
    <section
      ref={sheet}
      className={styles.sheet}
      aria-label={t('panelRail.label')}
      data-phone-sheet={height}
      data-orientation={layout}
    >
      <button
        ref={handle}
        type="button"
        className={styles.handle}
        aria-label={handleLabel}
        aria-expanded={height !== 'peek'}
        aria-controls={open ? panelId : undefined}
        aria-keyshortcuts="ArrowUp ArrowDown"
        data-sheet-handle
        onPointerDown={onPointerDown}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false
            return
          }
          moveTo(cyclePhoneSheet(height))
        }}
        onKeyDown={(event) => {
          dragged.current = false
          const next = stepPhoneSheet(height, event.key)
          if (!next) return
          event.preventDefault()
          if (next !== height) moveTo(next)
        }}
      >
        <span className={styles.grip} aria-hidden="true" />
      </button>
      <div className={styles.tabRow}>
        <div className={styles.tabs} role="tablist" aria-label={t('panelRail.label')} onKeyDown={onTabKeyDown}>
          {shown.map((command, index) => (
            <button
              key={command.panel}
              type="button"
              role="tab"
              className={styles.tab}
              data-sheet-tab
              data-panel={command.panel}
              data-command-id={command.id ?? command.commandId}
              aria-selected={command.active ?? false}
              aria-controls={command.active && open ? panelId : undefined}
              aria-disabled={command.disabled ? true : undefined}
              tabIndex={index === focusIndex ? 0 : -1}
              onClick={() => {
                if (command.disabled) return
                // A second press on the open tab rests the sheet, as the rail closes the dock.
                command.action()
              }}
            >
              <span className={styles.tabLabel}>{t(`webPhone.tabs.${command.panel}`)}</span>
            </button>
          ))}
        </div>
        {folded.length > 0 && (
          <ActionMenu
            label={t('panelRail.more')}
            triggerClassName={styles.tab}
            iconSize={20}
            triggerLabel={<span className={styles.tabLabel}>{t('webPhone.more')}</span>}
            triggerData={{
              'data-sheet-more': '',
              'data-holds-active': folded.some((command) => command.active) ? '' : undefined,
            }}
            items={folded.map((command) => ({
              id: command.id ?? command.commandId,
              label: command.label,
              checked: command.active ?? false,
              disabled: command.disabled,
              run: () => command.action(),
            }))}
          />
        )}
      </div>
      {height !== 'peek' && (
        <div id={panelId} className={styles.panel} role="tabpanel">
          {children}
        </div>
      )}
    </section>
  )
}

function release(sheet: HTMLElement): void {
  sheet.style.removeProperty('height')
  delete sheet.dataset.dragging
}
