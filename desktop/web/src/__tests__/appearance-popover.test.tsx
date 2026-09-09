import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { navigateAppearanceChoices, useAppearancePopover } from '../components/canvas/useAppearancePopover'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('appearance popover', () => {
  it('keeps an expanding picker inside the viewport and releases its subscriptions', async () => {
    let resize = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect = disconnect
    })
    vi.stubGlobal('innerHeight', 720)
    vi.stubGlobal('innerWidth', 1024)
    const removeListener = vi.spyOn(window, 'removeEventListener')
    let height = 300
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.tagName === 'BUTTON' ? new DOMRect(4, 490, 36, 32) : new DOMRect(0, 0, 336, height)
    })
    const buttonRef = { current: document.createElement('button') }
    const host = document.createElement('div')
    document.body.append(buttonRef.current, host)
    function Picker() {
      const ref = useAppearancePopover(true, buttonRef)
      return <div ref={ref} role="dialog" />
    }
    await act(() => render(<Picker />, host))
    const menu = host.querySelector<HTMLElement>('[role="dialog"]')!
    expect(menu.style.left).toBe('48px')
    expect(menu.style.top).toBe('412px')
    height = 500
    resize()
    expect(menu.style.top).toBe('212px')
    await act(() => render(null, host))
    expect(disconnect).toHaveBeenCalledOnce()
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function), true)
  })

  it('moves between both symbol rows without invoking the apply action', () => {
    const choose = vi.fn()
    const apply = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    render(<div role="dialog" onKeyDown={event => navigateAppearanceChoices(event, 5)}>
      {Array.from({ length: 10 }, (_, index) => <button role="option" key={index} onClick={() => choose(index)}>{index}</button>)}
      <button onClick={apply}>Apply</button>
    </div>, host)
    const options = host.querySelectorAll<HTMLButtonElement>('[role="option"]')
    options[0]!.focus()
    options[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(options[5])
    expect(choose).toHaveBeenLastCalledWith(5)
    options[5]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(options[9])
    options[9]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(options[0])
    expect(apply).not.toHaveBeenCalled()
    render(null, host)
  })
})
