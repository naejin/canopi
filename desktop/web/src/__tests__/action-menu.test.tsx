import { render } from 'preact'
import { act } from 'preact/test-utils'
import { expect, it, vi } from 'vitest'
import { ActionMenu } from '../components/shared/ActionMenu'

it('navigates commands without running them, restores focus on Escape and releases its portal', async () => {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const rename = vi.fn(), remove = vi.fn()
  try {
    await act(async () => render(<ActionMenu label="Stamp actions" items={[
      { label: 'Rename', run: rename }, { label: 'Delete', run: remove, danger: true },
    ]} />, root))
    const trigger = root.querySelector<HTMLButtonElement>('button')!
    await act(async () => trigger.click())
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!
    expect(root.contains(menu)).toBe(false)
    expect(document.activeElement?.textContent).toBe('Rename')
    await act(async () => { menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(document.activeElement?.textContent).toBe('Delete')
    expect(remove).not.toHaveBeenCalled()
    await act(async () => { menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await act(async () => trigger.click())
    await act(async () => { document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click() })
    expect(rename).toHaveBeenCalledTimes(1)
    expect(remove).not.toHaveBeenCalled()
    await act(async () => trigger.click())
    await act(async () => render(null, root))
    expect(document.querySelector('[role="menu"]')).toBeNull()
  } finally { render(null, root); root.remove() }
})

it('marks checkable, disabled and shortcut items with menu semantics', async () => {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const toggle = vi.fn(), locked = vi.fn()
  try {
    await act(async () => render(<ActionMenu label="View" items={[
      { label: 'Grid', run: toggle, checked: true, shortcut: 'G' },
      { label: 'Rulers', run: toggle, checked: false },
      { separator: true },
      { label: 'Lock', run: locked, disabled: true },
    ]} />, root))
    await act(async () => root.querySelector<HTMLButtonElement>('button')!.click())
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!
    const grid = menu.querySelector<HTMLElement>('[aria-label="Grid"]')!
    expect(grid.getAttribute('role')).toBe('menuitemcheckbox')
    expect(grid.getAttribute('aria-checked')).toBe('true')
    expect(grid.textContent).toContain('G')
    expect(menu.querySelector('[aria-label="Rulers"]')!.getAttribute('aria-checked')).toBe('false')
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1)

    const lock = menu.querySelector<HTMLButtonElement>('[aria-label="Lock"]')!
    expect(lock.getAttribute('role')).toBe('menuitem')
    expect(lock.getAttribute('aria-disabled')).toBe('true')
    await act(async () => lock.click())
    expect(locked).not.toHaveBeenCalled()
    expect(document.querySelector('[role="menu"]')).not.toBeNull()

    // Disabled items stay reachable by keyboard so they can be discovered.
    grid.focus()
    await act(async () => { menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })) })
    expect(document.activeElement).toBe(lock)
  } finally { render(null, root); root.remove() }
})

it('opens a submenu from its parent item and returns to it with ArrowLeft', async () => {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const byStratum = vi.fn()
  try {
    await act(async () => render(<ActionMenu label="Plant actions" items={[
      { label: 'Colour by', submenu: [{ label: 'Species', run: vi.fn() }, { label: 'Stratum', run: byStratum }] },
    ]} />, root))
    await act(async () => root.querySelector<HTMLButtonElement>('button')!.click())
    const parent = document.querySelector<HTMLButtonElement>('[aria-label="Colour by"]')!
    expect(parent.getAttribute('aria-haspopup')).toBe('menu')
    expect(parent.getAttribute('aria-expanded')).toBe('false')

    await act(async () => { parent.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(parent.getAttribute('aria-expanded')).toBe('true')
    const submenu = document.querySelector<HTMLElement>('[role="menu"][aria-label="Colour by"]')!
    expect(document.activeElement?.textContent).toBe('Species')

    await act(async () => { submenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) })
    expect(document.querySelector('[role="menu"][aria-label="Colour by"]')).toBeNull()
    expect(document.activeElement).toBe(parent)

    await act(async () => parent.click())
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Stratum"]')!.click())
    expect(byStratum).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="menu"]')).toBeNull()
  } finally { render(null, root); root.remove() }
})
