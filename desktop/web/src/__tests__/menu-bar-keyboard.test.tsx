import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuAction, MenuDefinition } from '../app/shell-commands/menus'
import { MenuBar } from '../components/shared/MenuBar'

function action(id: string, overrides: Partial<MenuAction> = {}): MenuAction {
  return { type: 'action', id, label: id, disabled: false, action: vi.fn(), ...overrides }
}

function menus(): MenuDefinition[] {
  return [
    {
      id: 'file',
      label: 'File',
      items: [
        action('new', { shortcut: 'Ctrl N', ariaShortcut: 'Control+N Meta+N' }),
        { type: 'separator' },
        {
          type: 'submenu',
          id: 'export',
          label: 'Export',
          disabled: false,
          items: [action('pdf'), action('geojson')],
        },
        { type: 'label', label: 'More' },
        action('quit', { disabled: true }),
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        action('grid', { check: 'checkbox', checked: true }),
        action('rulers', { check: 'checkbox', checked: false }),
        {
          type: 'submenu',
          id: 'background',
          label: 'Background',
          disabled: false,
          items: [action('map', { check: 'radio', checked: true }), action('none', { check: 'radio', checked: false })],
        },
      ],
    },
    { id: 'help', label: 'Help', items: [action('about')] },
  ]
}

describe('MenuBar keyboard and semantics', () => {
  let container: HTMLDivElement
  let items: MenuDefinition[]
  const onMenuOpen = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    items = menus()
    onMenuOpen.mockClear()
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  const trigger = (id: string) => container.querySelector<HTMLButtonElement>(`[data-menu-id="${id}"]`)!
  const openMenu = () => container.querySelector<HTMLElement>('[data-menu-popup="root"]')
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
  // Focus moves on the frame after the menu renders.
  const key = async (target: Element, name: string) => {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
    })
    await act(async () => { await frame() })
  }

  it('is a labelled menubar of menu buttons that open menus with shortcuts and a check column', async () => {
    await act(async () => { render(<MenuBar menus={items} label="Menus" onMenuOpen={onMenuOpen} />, container) })
    const bar = container.querySelector('[role="menubar"]')!
    expect(bar.getAttribute('aria-label')).toBe('Menus')
    expect(trigger('file').getAttribute('aria-haspopup')).toBe('menu')

    await act(async () => { trigger('view').click() })
    expect(onMenuOpen).toHaveBeenCalledWith('view')
    const view = openMenu()!
    const grid = view.querySelector('[data-command-id="grid"]')!
    expect(grid.getAttribute('role')).toBe('menuitemcheckbox')
    expect(grid.getAttribute('aria-checked')).toBe('true')
    expect(grid.querySelector('svg')).not.toBeNull()
    expect(view.querySelector('[data-command-id="rulers"]')!.getAttribute('aria-checked')).toBe('false')

    await act(async () => { trigger('file').click() })
    const file = openMenu()!
    expect(file.querySelector('[data-command-id="new"]')!.textContent).toBe('newCtrl N')
    expect(file.querySelector('[data-command-id="new"]')!.getAttribute('aria-keyshortcuts')).toBe('Control+N Meta+N')
    expect(file.querySelector('[role="separator"]')).not.toBeNull()
    expect(file.querySelector('[role="presentation"]')?.textContent).toBe('More')
    // No checkable items in File: no check column.
    expect(file.querySelector('[data-command-id="new"] > span')!.className).toContain('itemLabel')

    await act(async () => { trigger('file').click() })
    expect(openMenu()).toBeNull()
  })

  it('moves through items with arrows, Home and End, and between menus with Left and Right', async () => {
    await act(async () => { render(<MenuBar menus={items} label="Menus" />, container) })
    trigger('file').focus()
    await key(trigger('file'), 'ArrowDown')
    const file = openMenu()!
    expect(document.activeElement?.getAttribute('data-command-id')).toBe('new')

    await key(file, 'ArrowDown')
    expect(document.activeElement?.getAttribute('data-submenu-id')).toBe('export')
    await key(file, 'End')
    expect(document.activeElement?.getAttribute('data-command-id')).toBe('quit')
    await key(file, 'ArrowDown')
    expect(document.activeElement?.getAttribute('data-command-id')).toBe('new')
    await key(file, 'ArrowUp')
    expect(document.activeElement?.getAttribute('data-command-id')).toBe('quit')
    await key(file, 'Home')
    expect(document.activeElement?.getAttribute('data-command-id')).toBe('new')

    await key(file, 'ArrowRight')
    expect(trigger('view').getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement?.getAttribute('data-command-id')).toBe('grid')
    await key(openMenu()!, 'ArrowLeft')
    expect(trigger('file').getAttribute('aria-expanded')).toBe('true')

    await key(openMenu()!, 'Escape')
    expect(openMenu()).toBeNull()
    expect(document.activeElement).toBe(trigger('file'))
  })

  it('opens a submenu with Right, walks it, and returns with Left or Escape', async () => {
    await act(async () => { render(<MenuBar menus={items} label="Menus" />, container) })
    trigger('file').focus()
    await key(trigger('file'), 'Enter')
    const file = openMenu()!
    await key(file, 'ArrowDown')
    const exportTrigger = document.activeElement as HTMLElement
    await key(exportTrigger, 'ArrowRight')
    expect(exportTrigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement?.getAttribute('data-command-id')).toBe('pdf')

    const submenu = file.querySelector('[role="menu"]')!
    await key(submenu, 'ArrowDown')
    expect(document.activeElement?.getAttribute('data-command-id')).toBe('geojson')
    await key(submenu, 'ArrowDown')
    expect(document.activeElement?.getAttribute('data-command-id')).toBe('pdf')
    await key(submenu, 'End')
    expect(document.activeElement?.getAttribute('data-command-id')).toBe('geojson')
    await key(submenu, 'Home')
    await key(submenu, 'ArrowUp')
    expect(document.activeElement?.getAttribute('data-command-id')).toBe('geojson')
    await key(submenu, 'ArrowLeft')
    expect(document.activeElement).toBe(exportTrigger)
    expect(exportTrigger.getAttribute('aria-expanded')).toBe('false')

    await act(async () => { exportTrigger.click() })
    await act(async () => { await frame() })
    await key(file.querySelector('[role="menu"]')!, 'Escape')
    expect(file.querySelector('[role="menu"]')).toBeNull()
    expect(openMenu()).not.toBeNull()
  })

  it('runs an enabled item, closes and returns focus; disabled items stay put', async () => {
    await act(async () => { render(<MenuBar menus={items} label="Menus" />, container) })
    await act(async () => { trigger('file').click() })
    const quit = openMenu()!.querySelector<HTMLButtonElement>('[data-command-id="quit"]')!
    expect(quit.getAttribute('aria-disabled')).toBe('true')
    await act(async () => { quit.click() })
    expect((items[0]!.items[4] as MenuAction).action).not.toHaveBeenCalled()
    expect(openMenu()).not.toBeNull()

    await act(async () => { openMenu()!.querySelector<HTMLButtonElement>('[data-command-id="new"]')!.click() })
    expect((items[0]!.items[0] as MenuAction).action).toHaveBeenCalledOnce()
    expect(openMenu()).toBeNull()
    expect(document.activeElement).toBe(trigger('file'))
  })

  it('switches open menus on hover and closes on an outside press or Tab', async () => {
    await act(async () => { render(<MenuBar menus={items} label="Menus" />, container) })
    await act(async () => { trigger('file').dispatchEvent(new MouseEvent('mouseenter')) })
    expect(openMenu()).toBeNull()
    await act(async () => { trigger('file').click() })
    await act(async () => { trigger('help').dispatchEvent(new MouseEvent('mouseenter')) })
    expect(trigger('help').getAttribute('aria-expanded')).toBe('true')

    await act(async () => { document.body.dispatchEvent(new Event('pointerup', { bubbles: true })) })
    expect(openMenu()).toBeNull()

    trigger('view').focus()
    await key(trigger('view'), 'ArrowUp')
    expect(document.activeElement?.getAttribute('data-submenu-id')).toBe('background')
    await key(openMenu()!, 'Tab')
    expect(openMenu()).toBeNull()

    trigger('view').focus()
    await key(trigger('view'), 'ArrowRight')
    expect(document.activeElement).toBe(trigger('help'))
    await key(trigger('help'), 'ArrowLeft')
    expect(document.activeElement).toBe(trigger('view'))
  })

  it('marks radio submenu items with menuitemradio', async () => {
    await act(async () => { render(<MenuBar menus={items} label="Menus" />, container) })
    await act(async () => { trigger('view').click() })
    const wrap = openMenu()!.querySelector('[data-submenu-id="background"]')!.parentElement!
    await act(async () => { wrap.dispatchEvent(new MouseEvent('mouseenter')) })
    const map = openMenu()!.querySelector('[data-command-id="map"]')!
    expect(map.getAttribute('role')).toBe('menuitemradio')
    expect(map.getAttribute('aria-checked')).toBe('true')
  })
})
