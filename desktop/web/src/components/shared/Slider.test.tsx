import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Slider } from './Slider'

let container: HTMLDivElement

function slider(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('input[type="range"]')!
}

describe('Slider (finding 11)', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('shows the formatted value beside its label and speaks it as the value text', () => {
    act(() => {
      render(<Slider label="Opacity" value={40} min={0} max={100} format={(value) => `${value} %`} onInput={() => {}} />, container)
    })

    expect(container.querySelector('output')?.textContent).toBe('40 %')
    expect(slider().getAttribute('aria-valuetext')).toBe('40 %')
    expect(slider().min).toBe('0')
    expect(slider().max).toBe('100')
    expect(slider().value).toBe('40')
    const labelledBy = slider().getAttribute('aria-labelledby')!
    expect(document.getElementById(labelledBy)?.textContent).toBe('Opacity')
  })

  it('reports each step as a number while dragging', () => {
    const onInput = vi.fn()
    act(() => {
      render(<Slider label="Size" value={100} min={50} max={200} step={10} format={String} onInput={onInput} />, container)
    })

    act(() => {
      slider().value = '150'
      slider().dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(slider().step).toBe('10')
    expect(onInput).toHaveBeenCalledWith(150)
  })

  it('takes an accessible name that tells two sliders with one visible label apart, and can be disabled', () => {
    act(() => {
      render(<Slider label="Opacity" ariaLabel="Opacity: Zones" value={1} min={0} max={1} step={0.1} format={String} disabled onInput={() => {}} />, container)
    })

    expect(slider().getAttribute('aria-label')).toBe('Opacity: Zones')
    expect(slider().hasAttribute('aria-labelledby')).toBe(false)
    expect(slider().disabled).toBe(true)
  })
})
