import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dropdown } from '../components/shared/Dropdown'

describe('Dropdown keyboard interaction', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('opens, skips disabled options, selects, and restores trigger focus', async () => {
    const onChange = vi.fn()
    await act(async () => {
      render(
        <Dropdown
          trigger="One"
          items={[
            { value: 'one', label: 'One' },
            { value: 'disabled', label: 'Disabled', disabled: true },
            { value: 'two', label: 'Two' },
          ]}
          value="one"
          onChange={onChange}
          ariaLabel="Example"
          floating
        />,
        container,
      )
    })
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
    trigger.focus()

    await keyDown(trigger, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe('One')
    await keyDown(document.activeElement!, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe('Two')
    await keyDown(document.activeElement!, 'Enter')

    expect(onChange).toHaveBeenCalledWith('two')
    expect(document.querySelector('[role="listbox"][aria-label="Example"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('supports Home, End, current-value selection, and Escape', async () => {
    const onChange = vi.fn()
    await act(async () => {
      render(
        <Dropdown
          trigger="Two"
          items={[
            { value: 'one', label: 'One' },
            { value: 'two', label: 'Two' },
            { value: 'three', label: 'Three' },
          ]}
          value="two"
          onChange={onChange}
          ariaLabel="Example"
          floating
        />,
        container,
      )
    })
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!

    await act(async () => { trigger.click() })
    expect(document.activeElement?.textContent).toBe('Two')
    await keyDown(document.activeElement!, 'Home')
    expect(document.activeElement?.textContent).toBe('One')
    await keyDown(document.activeElement!, 'End')
    expect(document.activeElement?.textContent).toBe('Three')
    await keyDown(document.activeElement!, 'Escape')
    expect(document.activeElement).toBe(trigger)

    await act(async () => { trigger.click() })
    expect(document.activeElement?.textContent).toBe('Two')
    await keyDown(document.activeElement!, ' ')
    expect(onChange).toHaveBeenCalledWith('two')
    expect(document.activeElement).toBe(trigger)
  })

  it('dismisses a focused floating menu on viewport changes without stranding focus', async () => {
    await act(async () => {
      render(
        <Dropdown
          trigger="One"
          items={[{ value: 'one', label: 'One' }]}
          value="one"
          onChange={() => {}}
          ariaLabel="Example"
          floating
        />,
        container,
      )
    })
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
    await act(async () => { trigger.click() })

    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(document.querySelector('[role="listbox"][aria-label="Example"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    await act(async () => { trigger.click() })
    await act(async () => {
      container.dispatchEvent(new Event('scroll', { bubbles: false }))
    })
    expect(document.querySelector('[role="listbox"][aria-label="Example"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('dismisses on an outside pointer without stealing outside focus', async () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    await act(async () => {
      render(
        <Dropdown
          trigger="One"
          items={[{ value: 'one', label: 'One' }]}
          value="one"
          onChange={() => {}}
          ariaLabel="Example"
          floating
        />,
        container,
      )
    })
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
    await act(async () => { trigger.click() })
    outside.focus()

    await act(async () => {
      outside.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })

    expect(document.querySelector('[role="listbox"][aria-label="Example"]')).toBeNull()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})

async function keyDown(target: Element, key: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}
