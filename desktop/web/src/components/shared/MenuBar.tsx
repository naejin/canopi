import { useRef } from 'preact/hooks'
import { useSignal, useSignalEffect } from '@preact/signals'
import type { MenuAction, MenuDefinition, MenuEntry } from '../../app/shell-commands/menus'
import { ControlIcon } from './ControlIcon'
import styles from './MenuBar.module.css'

const wrapPrev = (i: number, len: number) => i > 0 ? i - 1 : len - 1
const wrapNext = (i: number, len: number) => i < len - 1 ? i + 1 : 0

interface MenuBarProps {
  readonly menus: readonly MenuDefinition[]
  readonly label: string
  /** Called when a menu opens, so callers can refresh data it lists (Open recent). */
  readonly onMenuOpen?: (menuId: string) => void
}

/**
 * The title-bar menu bar: a `menubar` of menu buttons, each opening a `menu`
 * of commands with their shortcuts. Checkable items are `menuitemcheckbox`
 * or `menuitemradio`, and a check column is reserved when a menu has any.
 */
export function MenuBar({ menus, label, onMenuOpen }: MenuBarProps) {
  const openMenuId = useSignal<string | null>(null)
  const openSubmenuId = useSignal<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const submenuTriggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const submenuRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useSignalEffect(() => {
    if (!openMenuId.value) return
    const handleOutside = (event: Event) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) closeAll(false)
    }
    document.addEventListener('pointerup', handleOutside)
    return () => document.removeEventListener('pointerup', handleOutside)
  })

  function rootItems(menuEl: HTMLElement): HTMLButtonElement[] {
    return Array.from(menuEl.querySelectorAll<HTMLButtonElement>('[data-menu-root-item="true"]'))
  }

  function focusRootItemAfterRender(position: 'first' | 'last' = 'first'): void {
    requestAnimationFrame(() => {
      const menuEl = barRef.current?.querySelector<HTMLElement>('[data-menu-popup="root"]')
      if (!menuEl) return
      const items = rootItems(menuEl)
      ;(position === 'first' ? items[0] : items.at(-1))?.focus()
    })
  }

  function focusFirstSubmenuItemAfterRender(submenuId: string): void {
    requestAnimationFrame(() => {
      submenuRefs.current.get(submenuId)?.querySelector<HTMLButtonElement>('button')?.focus()
    })
  }

  function openRootMenu(menuId: string): void {
    openMenuId.value = menuId
    openSubmenuId.value = null
    onMenuOpen?.(menuId)
  }

  function closeAll(returnFocus: boolean): void {
    const triggerId = openMenuId.value
    openMenuId.value = null
    openSubmenuId.value = null
    if (returnFocus && triggerId) triggerRefs.current.get(triggerId)?.focus()
  }

  function moveToSiblingMenu(menuId: string, direction: -1 | 1): void {
    const index = menus.findIndex((menu) => menu.id === menuId)
    const next = menus[direction < 0 ? wrapPrev(index, menus.length) : wrapNext(index, menus.length)]
    if (!next) return
    openRootMenu(next.id)
    focusRootItemAfterRender()
  }

  function runAction(entry: MenuAction): void {
    if (entry.disabled) return
    closeAll(true)
    entry.action()
  }

  function handleMenuKeyDown(event: KeyboardEvent, menu: MenuDefinition): void {
    const items = rootItems(event.currentTarget as HTMLElement)
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        items[wrapNext(index, items.length)]?.focus()
        break
      case 'ArrowUp':
        event.preventDefault()
        items[wrapPrev(index < 0 ? 0 : index, items.length)]?.focus()
        break
      case 'Home':
        event.preventDefault()
        items[0]?.focus()
        break
      case 'End':
        event.preventDefault()
        items.at(-1)?.focus()
        break
      case 'ArrowLeft':
        event.preventDefault()
        moveToSiblingMenu(menu.id, -1)
        break
      case 'ArrowRight': {
        event.preventDefault()
        const submenuId = (event.target as HTMLElement).dataset.submenuId
        const entry = submenuId ? menu.items.find((item) => item.type === 'submenu' && item.id === submenuId) : null
        if (entry?.type === 'submenu' && !entry.disabled) {
          openSubmenuId.value = entry.id
          focusFirstSubmenuItemAfterRender(entry.id)
          break
        }
        moveToSiblingMenu(menu.id, 1)
        break
      }
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        closeAll(true)
        break
      case 'Tab':
        closeAll(false)
        break
    }
  }

  function handleSubmenuKeyDown(event: KeyboardEvent, submenuId: string): void {
    const items = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button'))
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const stop = () => { event.preventDefault(); event.stopPropagation() }
    switch (event.key) {
      case 'ArrowDown': stop(); items[wrapNext(index, items.length)]?.focus(); break
      case 'ArrowUp': stop(); items[wrapPrev(index < 0 ? 0 : index, items.length)]?.focus(); break
      case 'Home': stop(); items[0]?.focus(); break
      case 'End': stop(); items.at(-1)?.focus(); break
      case 'ArrowLeft':
      case 'Escape':
        stop()
        openSubmenuId.value = null
        submenuTriggerRefs.current.get(submenuId)?.focus()
        break
      case 'ArrowRight': stop(); break
    }
  }

  function handleTriggerKeyDown(event: KeyboardEvent, menuId: string): void {
    const index = menus.findIndex((menu) => menu.id === menuId)
    switch (event.key) {
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        event.preventDefault()
        openRootMenu(menuId)
        focusRootItemAfterRender()
        break
      case 'ArrowUp':
        event.preventDefault()
        openRootMenu(menuId)
        focusRootItemAfterRender('last')
        break
      case 'ArrowLeft':
      case 'ArrowRight': {
        event.preventDefault()
        const next = menus[event.key === 'ArrowLeft' ? wrapPrev(index, menus.length) : wrapNext(index, menus.length)]
        if (!next) break
        triggerRefs.current.get(next.id)?.focus()
        if (openMenuId.value) openRootMenu(next.id)
        break
      }
      case 'Escape':
        if (openMenuId.value) {
          event.preventDefault()
          closeAll(true)
        }
        break
    }
  }

  function renderAction(entry: MenuAction, rootItem: boolean, checkable: boolean) {
    const role = entry.check === 'radio' ? 'menuitemradio' : entry.check === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'
    return (
      <button
        key={entry.id}
        className={styles.item}
        role={role}
        type="button"
        tabIndex={-1}
        aria-checked={entry.check ? entry.checked === true : undefined}
        aria-disabled={entry.disabled ? true : undefined}
        aria-keyshortcuts={entry.ariaShortcut}
        data-command-id={entry.id}
        data-menu-root-item={rootItem ? 'true' : undefined}
        onMouseEnter={() => { if (rootItem) openSubmenuId.value = null }}
        onFocus={() => { if (rootItem) openSubmenuId.value = null }}
        onClick={() => runAction(entry)}
      >
        {checkable && (
          <span className={styles.check} aria-hidden="true">
            {entry.checked && <ControlIcon name="check" />}
          </span>
        )}
        <span className={styles.itemLabel}>{entry.label}</span>
        {entry.shortcut && <span className={styles.itemShortcut} aria-hidden="true">{entry.shortcut}</span>}
      </button>
    )
  }

  function renderEntry(entry: MenuEntry, index: number, checkable: boolean) {
    if (entry.type === 'separator') return <div key={`sep-${index}`} className={styles.separator} role="separator" />
    if (entry.type === 'label') return <div key={`label-${index}`} className={styles.heading} role="presentation">{entry.label}</div>
    if (entry.type === 'action') return renderAction(entry, true, checkable)
    const submenuOpen = openSubmenuId.value === entry.id && !entry.disabled
    const submenuCheckable = entry.items.some((item) => item.check)
    return (
      <div key={entry.id} className={styles.submenuWrap} onMouseEnter={() => { if (!entry.disabled) openSubmenuId.value = entry.id }}>
        <button
          ref={(element) => {
            if (element) submenuTriggerRefs.current.set(entry.id, element)
            else submenuTriggerRefs.current.delete(entry.id)
          }}
          className={styles.item}
          role="menuitem"
          type="button"
          tabIndex={-1}
          aria-disabled={entry.disabled ? true : undefined}
          aria-haspopup="menu"
          aria-expanded={submenuOpen}
          data-menu-root-item="true"
          data-submenu-id={entry.id}
          onClick={() => {
            if (entry.disabled) return
            openSubmenuId.value = entry.id
            focusFirstSubmenuItemAfterRender(entry.id)
          }}
        >
          {checkable && <span className={styles.check} aria-hidden="true" />}
          <span className={styles.itemLabel}>{entry.label}</span>
          <ControlIcon name="chevron-right" className={styles.submenuChevron} />
        </button>
        {submenuOpen && (
          <div
            ref={(element) => {
              if (element) submenuRefs.current.set(entry.id, element)
              else submenuRefs.current.delete(entry.id)
            }}
            className={`${styles.menu} ${styles.submenu}`}
            role="menu"
            aria-label={entry.label}
            onKeyDown={(event) => handleSubmenuKeyDown(event, entry.id)}
          >
            {entry.items.map((item) => renderAction(item, false, submenuCheckable))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={styles.menuBar} ref={barRef} role="menubar" aria-label={label}>
      {menus.map((menu) => {
        const isOpen = openMenuId.value === menu.id
        const checkable = menu.items.some((entry) => entry.type === 'action' && entry.check !== undefined)
        return (
          <div key={menu.id} className={styles.menuGroup}>
            <button
              ref={(element) => {
                if (element) triggerRefs.current.set(menu.id, element)
                else triggerRefs.current.delete(menu.id)
              }}
              className={styles.trigger}
              type="button"
              role="menuitem"
              data-menu-id={menu.id}
              onClick={() => { if (isOpen) closeAll(false); else openRootMenu(menu.id) }}
              onMouseEnter={() => { if (openMenuId.value !== null && openMenuId.value !== menu.id) openRootMenu(menu.id) }}
              onKeyDown={(event) => handleTriggerKeyDown(event, menu.id)}
              aria-expanded={isOpen}
              aria-haspopup="menu"
            >
              {menu.label}
            </button>
            {isOpen && (
              <div
                className={styles.menu}
                role="menu"
                aria-label={menu.label}
                data-menu-popup="root"
                onKeyDown={(event) => handleMenuKeyDown(event, menu)}
              >
                {menu.items.map((entry, index) => renderEntry(entry, index, checkable))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
