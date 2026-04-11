import { useRef } from 'preact/hooks'
import { useSignal, useSignalEffect } from '@preact/signals'
import { locale } from '../../state/app'
import { currentCanvasSession } from '../../canvas/session'
import { currentDesign, designDirty } from '../../state/document'
import { getMenuDefinitions, type MenuDefinition, type MenuEntry } from './menu-definitions'
import styles from './MenuBar.module.css'

const wrapPrev = (i: number, len: number) => i > 0 ? i - 1 : len - 1
const wrapNext = (i: number, len: number) => i < len - 1 ? i + 1 : 0

export function MenuBar() {
  const openMenuId = useSignal<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const focusedItemIndex = useRef(-1)

  // Subscribe to signals that affect menu content (disabled states, labels)
  void locale.value
  void currentDesign.value
  void designDirty.value
  void currentCanvasSession.value

  const menus = getMenuDefinitions()

  // Close on click-outside (pointerup)
  useSignalEffect(() => {
    if (!openMenuId.value) return
    const handleOutside = (e: Event) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        openMenuId.value = null
      }
    }
    document.addEventListener('pointerup', handleOutside)
    return () => {
      document.removeEventListener('pointerup', handleOutside)
    }
  })

  const focusItem = (menuEl: HTMLElement, index: number) => {
    const items = menuEl.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    const item = items[index]
    if (item) {
      focusedItemIndex.current = index
      item.focus()
    }
  }

  const focusFirstItemAfterRender = () => {
    requestAnimationFrame(() => {
      const menuEl = barRef.current?.querySelector('[role="menu"]') as HTMLElement | null
      if (menuEl) focusItem(menuEl, 0)
    })
  }

  const handleMenuKeyDown = (e: KeyboardEvent, menu: MenuDefinition) => {
    const menuEl = (e.currentTarget as HTMLElement)
    const items = menuEl.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    const count = items.length

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        focusItem(menuEl, wrapNext(focusedItemIndex.current, count))
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        focusItem(menuEl, wrapPrev(focusedItemIndex.current, count))
        break
      }
      case 'Home': {
        e.preventDefault()
        focusItem(menuEl, 0)
        break
      }
      case 'End': {
        e.preventDefault()
        focusItem(menuEl, count - 1)
        break
      }
      case 'ArrowLeft': {
        e.preventDefault()
        const idx = menus.findIndex((m) => m.id === menu.id)
        const prev = menus[wrapPrev(idx, menus.length)]
        if (prev) {
          openMenuId.value = prev.id
          focusedItemIndex.current = -1
          focusFirstItemAfterRender()
        }
        break
      }
      case 'ArrowRight': {
        e.preventDefault()
        const idx = menus.findIndex((m) => m.id === menu.id)
        const next = menus[wrapNext(idx, menus.length)]
        if (next) {
          openMenuId.value = next.id
          focusedItemIndex.current = -1
          focusFirstItemAfterRender()
        }
        break
      }
      case 'Escape': {
        e.preventDefault()
        e.stopPropagation()
        const triggerId = openMenuId.value
        openMenuId.value = null
        focusedItemIndex.current = -1
        if (triggerId) triggerRefs.current.get(triggerId)?.focus()
        break
      }
    }
  }

  const handleTriggerKeyDown = (e: KeyboardEvent, menuId: string) => {
    const idx = menus.findIndex((m) => m.id === menuId)

    switch (e.key) {
      case 'ArrowDown':
      case 'Enter':
      case ' ': {
        e.preventDefault()
        openMenuId.value = menuId
        focusedItemIndex.current = -1
        focusFirstItemAfterRender()
        break
      }
      case 'ArrowLeft': {
        e.preventDefault()
        const prev = menus[wrapPrev(idx, menus.length)]
        if (prev) {
          triggerRefs.current.get(prev.id)?.focus()
          if (openMenuId.value) openMenuId.value = prev.id
        }
        break
      }
      case 'ArrowRight': {
        e.preventDefault()
        const next = menus[wrapNext(idx, menus.length)]
        if (next) {
          triggerRefs.current.get(next.id)?.focus()
          if (openMenuId.value) openMenuId.value = next.id
        }
        break
      }
    }
  }

  const handleTriggerClick = (id: string) => {
    openMenuId.value = openMenuId.value === id ? null : id
    focusedItemIndex.current = -1
  }

  const handleTriggerEnter = (id: string) => {
    if (openMenuId.value != null && openMenuId.value !== id) {
      openMenuId.value = id
      focusedItemIndex.current = -1
    }
  }

  const handleItemClick = (entry: MenuEntry) => {
    if (entry.type !== 'action' || entry.disabled) return
    openMenuId.value = null
    focusedItemIndex.current = -1
    entry.action()
  }

  return (
    <div className={styles.menuBar} ref={barRef} role="menubar">
      {menus.map((menu) => {
        const isOpen = openMenuId.value === menu.id
        return (
          <div key={menu.id} className={styles.menuGroup}>
            <button
              ref={(el) => { if (el) triggerRefs.current.set(menu.id, el); else triggerRefs.current.delete(menu.id) }}
              className={`${styles.trigger}${isOpen ? ` ${styles.triggerOpen}` : ''}`}
              type="button"
              onClick={() => handleTriggerClick(menu.id)}
              onMouseEnter={() => handleTriggerEnter(menu.id)}
              onKeyDown={(e) => handleTriggerKeyDown(e, menu.id)}
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
                onKeyDown={(e) => handleMenuKeyDown(e, menu)}
              >
                {menu.items.map((entry, i) => {
                  if (entry.type === 'separator') {
                    return <div key={`sep-${i}`} className={styles.separator} role="separator" />
                  }
                  return (
                    <button
                      key={entry.id}
                      className={`${styles.item}${entry.disabled ? ` ${styles.itemDisabled}` : ''}`}
                      role="menuitem"
                      type="button"
                      tabIndex={-1}
                      aria-disabled={entry.disabled}
                      onClick={() => handleItemClick(entry)}
                    >
                      <span className={styles.itemLabel}>{entry.label}</span>
                      {entry.shortcut && <span className={styles.itemShortcut}>{entry.shortcut}</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
