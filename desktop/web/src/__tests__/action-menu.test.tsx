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
