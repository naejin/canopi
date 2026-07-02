import { useEffect, useRef } from 'preact/hooks'
import { useSignal, useSignalEffect } from '@preact/signals'
import { appCommandGraphChromeProjection, type MenuAction, type MenuDefinition, type MenuEntry } from './menu-definitions'
import { designNotebookWorkbench } from '../../app/design-notebook'
import styles from './MenuBar.module.css'

const wrapPrev = (i: number, len: number) => i > 0 ? i - 1 : len - 1
const wrapNext = (i: number, len: number) => i < len - 1 ? i + 1 : 0

export function MenuBar() {
  const openMenuId = useSignal<string | null>(null)
  const openSubmenuId = useSignal<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const submenuTriggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const submenuRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const focusedItemIndex = useRef(-1)

  const menus = appCommandGraphChromeProjection.value.menus

  useEffect(() => {
    void designNotebookWorkbench.loadRecentDesigns()
  }, [])

  // Close on click-outside (pointerup)
  useSignalEffect(() => {
    if (!openMenuId.value) return
    const handleOutside = (e: Event) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        openMenuId.value = null
        openSubmenuId.value = null
      }
    }
    document.addEventListener('pointerup', handleOutside)
    return () => {
      document.removeEventListener('pointerup', handleOutside)
    }
  })

  const focusItem = (menuEl: HTMLElement, index: number) => {
    const items = menuEl.querySelectorAll<HTMLButtonElement>('[data-menu-root-item="true"]')
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

  const focusFirstSubmenuItemAfterRender = (submenuId: string) => {
    requestAnimationFrame(() => {
      const submenuEl = submenuRefs.current.get(submenuId)
      submenuEl?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    })
  }

  const refreshMenuData = (menuId: string) => {
    if (menuId === 'file') {
      void designNotebookWorkbench.loadRecentDesigns()
    }
  }

  const openRootMenu = (menuId: string) => {
    openMenuId.value = menuId
    refreshMenuData(menuId)
  }

  const openSubmenu = (entry: MenuEntry): boolean => {
    if (entry.type !== 'submenu' || entry.disabled) return false
    openSubmenuId.value = entry.id
    return true
  }

  const handleMenuKeyDown = (e: KeyboardEvent, menu: MenuDefinition) => {
    const menuEl = (e.currentTarget as HTMLElement)
    const items = menuEl.querySelectorAll<HTMLButtonElement>('[data-menu-root-item="true"]')
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
        openSubmenuId.value = null
        const idx = menus.findIndex((m) => m.id === menu.id)
        const prev = menus[wrapPrev(idx, menus.length)]
        if (prev) {
          openRootMenu(prev.id)
          focusedItemIndex.current = -1
          focusFirstItemAfterRender()
        }
        break
      }
      case 'ArrowRight': {
        e.preventDefault()
        const submenuId = (e.target as HTMLElement).dataset.submenuId
        if (submenuId) {
          const submenuEntry = menu.items.find((entry) => entry.type === 'submenu' && entry.id === submenuId)
          if (submenuEntry?.type === 'submenu' && openSubmenu(submenuEntry)) {
            focusFirstSubmenuItemAfterRender(submenuEntry.id)
            break
          }
        }
        const idx = menus.findIndex((m) => m.id === menu.id)
        const next = menus[wrapNext(idx, menus.length)]
        if (next) {
          openRootMenu(next.id)
          openSubmenuId.value = null
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
        openSubmenuId.value = null
        focusedItemIndex.current = -1
        if (triggerId) triggerRefs.current.get(triggerId)?.focus()
        break
      }
    }
  }

  const handleSubmenuKeyDown = (e: KeyboardEvent, submenuId: string) => {
    const submenuEl = e.currentTarget as HTMLElement
    const items = submenuEl.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    const activeIndex = Array.from(items).indexOf(document.activeElement as HTMLButtonElement)

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        e.stopPropagation()
        items[wrapNext(activeIndex, items.length)]?.focus()
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        e.stopPropagation()
        items[wrapPrev(activeIndex, items.length)]?.focus()
        break
      }
      case 'Home': {
        e.preventDefault()
        e.stopPropagation()
        items[0]?.focus()
        break
      }
      case 'End': {
        e.preventDefault()
        e.stopPropagation()
        items[items.length - 1]?.focus()
        break
      }
      case 'ArrowLeft': {
        e.preventDefault()
        e.stopPropagation()
        openSubmenuId.value = null
        submenuTriggerRefs.current.get(submenuId)?.focus()
        break
      }
      case 'Escape': {
        e.preventDefault()
        e.stopPropagation()
        const triggerId = openMenuId.value
        openMenuId.value = null
        openSubmenuId.value = null
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
        openRootMenu(menuId)
        openSubmenuId.value = null
        focusedItemIndex.current = -1
        focusFirstItemAfterRender()
        break
      }
      case 'ArrowLeft': {
        e.preventDefault()
        const prev = menus[wrapPrev(idx, menus.length)]
        if (prev) {
          triggerRefs.current.get(prev.id)?.focus()
          if (openMenuId.value) openRootMenu(prev.id)
          openSubmenuId.value = null
        }
        break
      }
      case 'ArrowRight': {
        e.preventDefault()
        const next = menus[wrapNext(idx, menus.length)]
        if (next) {
          triggerRefs.current.get(next.id)?.focus()
          if (openMenuId.value) openRootMenu(next.id)
          openSubmenuId.value = null
        }
        break
      }
    }
  }

  const handleTriggerClick = (id: string) => {
    const nextMenuId = openMenuId.value === id ? null : id
    openMenuId.value = nextMenuId
    if (nextMenuId) refreshMenuData(nextMenuId)
    openSubmenuId.value = null
    focusedItemIndex.current = -1
  }

  const handleTriggerEnter = (id: string) => {
    if (openMenuId.value != null && openMenuId.value !== id) {
      openRootMenu(id)
      openSubmenuId.value = null
      focusedItemIndex.current = -1
    }
  }

  const handleItemClick = (entry: MenuEntry) => {
    if (entry.type === 'submenu') {
      if (openSubmenu(entry)) {
        focusFirstSubmenuItemAfterRender(entry.id)
      }
      return
    }
    if (entry.type !== 'action' || entry.disabled) return
    openMenuId.value = null
    openSubmenuId.value = null
    focusedItemIndex.current = -1
    entry.action()
  }

  const renderActionItem = (entry: MenuAction, rootItem: boolean) => (
    <button
      key={entry.id}
      className={`${styles.item}${entry.disabled ? ` ${styles.itemDisabled}` : ''}`}
      role="menuitem"
      type="button"
      tabIndex={-1}
      aria-disabled={entry.disabled}
      data-menu-root-item={rootItem ? 'true' : undefined}
      onMouseEnter={() => {
        if (rootItem) openSubmenuId.value = null
      }}
      onFocus={() => {
        if (rootItem) openSubmenuId.value = null
      }}
      onClick={() => handleItemClick(entry)}
    >
      <span className={styles.itemLabel}>{entry.label}</span>
      {entry.shortcut && <span className={styles.itemShortcut}>{entry.shortcut}</span>}
    </button>
  )

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
                  if (entry.type === 'label') {
                    return <div key={`label-${i}`} className={styles.label}>{entry.label}</div>
                  }
                  if (entry.type === 'submenu') {
                    const submenuOpen = openSubmenuId.value === entry.id && !entry.disabled
                    return (
                      <div
                        key={entry.id}
                        className={styles.submenuWrap}
                        onMouseEnter={() => openSubmenu(entry)}
                      >
                        <button
                          ref={(el) => { if (el) submenuTriggerRefs.current.set(entry.id, el); else submenuTriggerRefs.current.delete(entry.id) }}
                          className={`${styles.item}${entry.disabled ? ` ${styles.itemDisabled}` : ''}`}
                          role="menuitem"
                          type="button"
                          tabIndex={-1}
                          disabled={entry.disabled}
                          aria-disabled={entry.disabled}
                          aria-haspopup="menu"
                          aria-expanded={submenuOpen}
                          data-menu-root-item="true"
                          data-submenu-id={entry.id}
                          onFocus={() => openSubmenu(entry)}
                          onClick={() => handleItemClick(entry)}
                        >
                          <span className={styles.itemLabel}>{entry.label}</span>
                          <span className={styles.submenuArrow} aria-hidden="true">›</span>
                        </button>
                        {submenuOpen && (
                          <div
                            ref={(el) => { if (el) submenuRefs.current.set(entry.id, el); else submenuRefs.current.delete(entry.id) }}
                            className={styles.submenu}
                            role="menu"
                            aria-label={entry.label}
                            onKeyDown={(event) => handleSubmenuKeyDown(event, entry.id)}
                          >
                            {entry.items.map((item) => renderActionItem(item, false))}
                          </div>
                        )}
                      </div>
                    )
                  }
                  return renderActionItem(entry, true)
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
