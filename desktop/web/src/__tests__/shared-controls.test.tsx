import { render } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dropdown } from '../components/shared/Dropdown'
import { Notice } from '../components/shared/Notice'
import { SegmentedControl } from '../components/shared/SegmentedControl'
import { SpeciesIdentity } from '../components/shared/SpeciesIdentity'
import { SurfaceSearch } from '../components/shared/SurfaceSearch'
import { Switch } from '../components/shared/Switch'
import { Toast } from '../components/shared/Toast'

let root: HTMLDivElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  render(null, root)
  root.remove()
  vi.useRealTimers()
})

/** The accessible name from aria-labelledby, or aria-label, or text content. */
function accessibleName(element: Element): string {
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) {
    return labelledBy.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ')
  }
  return element.getAttribute('aria-label') ?? element.textContent?.trim() ?? ''
}

async function keyDown(target: Element, key: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

describe('Dropdown', () => {
  it('names its trigger with the field label and the current value', async () => {
    function Harness() {
      const [value, setValue] = useState('metric')
      return (
        <Dropdown
          trigger={value === 'metric' ? 'Metric' : 'Imperial'}
          items={[{ value: 'metric', label: 'Metric' }, { value: 'imperial', label: 'Imperial' }]}
          value={value}
          onChange={setValue}
          ariaLabel="Units"
        />
      )
    }
    await act(async () => render(<Harness />, root))
    const trigger = root.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
    expect(accessibleName(trigger)).toBe('Units Metric')

    await act(async () => trigger.click())
    expect(document.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('Units')
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
        .find((option) => option.textContent === 'Imperial')!.click()
    })
    expect(accessibleName(trigger)).toBe('Units Imperial')
  })
})

describe('SegmentedControl', () => {
  function Harness({ onChange }: { onChange(value: string): void }) {
    const [value, setValue] = useState('week')
    return (
      <SegmentedControl
        label="Calendar view"
        options={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month', disabled: true },
          { value: 'year', label: 'Year' },
        ]}
        value={value}
        onChange={(next) => { setValue(next); onChange(next) }}
      />
    )
  }

  it('is a named radio group with one tab stop on the checked segment', async () => {
    await act(async () => render(<Harness onChange={() => {}} />, root))
    const group = root.querySelector('[role="radiogroup"]')!
    expect(group.getAttribute('aria-label')).toBe('Calendar view')
    const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false'])
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1, -1])
    expect(radios[2]!.getAttribute('aria-disabled')).toBe('true')
  })

  it('moves and selects with arrow keys, skipping disabled segments and wrapping', async () => {
    const onChange = vi.fn()
    await act(async () => render(<Harness onChange={onChange} />, root))
    const radio = (label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
      .find((candidate) => candidate.textContent === label)!

    radio('Week').focus()
    await keyDown(radio('Week'), 'ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith('year')
    expect(document.activeElement).toBe(radio('Year'))
    expect(radio('Year').getAttribute('aria-checked')).toBe('true')

    await keyDown(radio('Year'), 'ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith('day')
    await keyDown(radio('Day'), 'ArrowLeft')
    expect(onChange).toHaveBeenLastCalledWith('year')
    await keyDown(radio('Year'), 'Home')
    expect(onChange).toHaveBeenLastCalledWith('day')
    await keyDown(radio('Day'), 'End')
    expect(onChange).toHaveBeenLastCalledWith('year')
    expect(document.activeElement).toBe(radio('Year'))
  })

  it('selects on click but ignores disabled segments', async () => {
    const onChange = vi.fn()
    await act(async () => render(<Harness onChange={onChange} />, root))
    const radios = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
    await act(async () => radios[2]!.click())
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => radios[0]!.click())
    expect(onChange).toHaveBeenCalledWith('day')
  })
})

describe('Switch', () => {
  it('is a labelled checkbox with the switch role that reports its new state', async () => {
    const onChange = vi.fn()
    await act(async () => render(<Switch label="Single-key shortcuts" hint="Only while the map has focus" checked={false} onChange={onChange} />, root))
    const input = root.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(input.getAttribute('role')).toBe('switch')
    expect(input.checked).toBe(false)
    expect(input.closest('label')?.textContent).toContain('Single-key shortcuts')
    expect(accessibleName(input)).toBe('Single-key shortcuts')
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent)
      .toBe('Only while the map has focus')

    await act(async () => input.click())
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('stays controlled and cannot change while disabled', async () => {
    const onChange = vi.fn()
    await act(async () => render(<Switch label="Rulers" checked disabled onChange={onChange} />, root))
    const input = root.querySelector<HTMLInputElement>('input[role="switch"]')!
    expect(input.checked).toBe(true)
    expect(input.disabled).toBe(true)
    await act(async () => input.click())
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('Notice', () => {
  it('announces errors as alerts, warnings as status and leaves info quiet', async () => {
    await act(async () => render(<>
      <Notice tone="error">Couldn't save</Notice>
      <Notice tone="warning">Imagery is older than a year</Notice>
      <Notice tone="info">Drop a file to add it</Notice>
    </>, root))
    const notices = Array.from(root.querySelectorAll('[data-notice-tone]'))
    expect(notices.map((notice) => [notice.getAttribute('data-notice-tone'), notice.getAttribute('role')])).toEqual([
      ['error', 'alert'],
      ['warning', 'status'],
      ['info', null],
    ])
  })
})

describe('Toast', () => {
  it('is a status message whose action runs once and dismisses it', async () => {
    const onAction = vi.fn()
    const onDismiss = vi.fn()
    await act(async () => render(
      <Toast message="Deleted 3 plants" actionLabel="Undo" onAction={onAction} onDismiss={onDismiss} />,
      root,
    ))
    const toast = root.querySelector('[role="status"]')!
    expect(toast.textContent).toContain('Deleted 3 plants')
    await act(async () => toast.querySelector<HTMLButtonElement>('button')!.click())
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('times out, but never while hovered or focused', async () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    await act(async () => render(
      <Toast message="Deleted 3 plants" actionLabel="Undo" onAction={() => {}} onDismiss={onDismiss} timeoutMs={5000} />,
      root,
    ))
    const toast = root.querySelector<HTMLElement>('[role="status"]')!

    await act(async () => { toast.dispatchEvent(new Event('pointerenter')) })
    await act(async () => { vi.advanceTimersByTime(20_000) })
    expect(onDismiss).not.toHaveBeenCalled()

    await act(async () => { toast.dispatchEvent(new Event('pointerleave')) })
    const action = toast.querySelector<HTMLButtonElement>('button')!
    await act(async () => { action.focus() })
    await act(async () => { vi.advanceTimersByTime(20_000) })
    expect(onDismiss).not.toHaveBeenCalled()

    await act(async () => { action.blur() })
    await act(async () => { vi.advanceTimersByTime(4999) })
    expect(onDismiss).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('SpeciesIdentity', () => {
  it('shows the common name over the scientific name marked as Latin', async () => {
    await act(async () => render(<SpeciesIdentity commonName="Apple" canonicalName="Malus domestica" />, root))
    expect(root.querySelector('strong')?.textContent).toBe('Apple')
    const scientific = root.querySelector('em')!
    expect(scientific.textContent).toBe('Malus domestica')
    expect(scientific.getAttribute('lang')).toBe('la')
  })
})

describe('SurfaceSearch', () => {
  it('shows the key hint until there is text, then a clear button that refocuses the field', async () => {
    function Harness() {
      const [value, setValue] = useState('')
      return <SurfaceSearch value={value} onChange={setValue} label="Find plants" shortcutHint="Ctrl F" keyShortcuts="Control+F" />
    }
    await act(async () => render(<Harness />, root))
    const input = root.querySelector<HTMLInputElement>('input[type="search"]')!
    expect(input.getAttribute('aria-keyshortcuts')).toBe('Control+F')
    expect(root.querySelector('kbd')?.textContent).toBe('Ctrl F')
    expect(root.querySelector('button')).toBeNull()

    await act(async () => {
      input.value = 'mal'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(root.querySelector('kbd')).toBeNull()
    await act(async () => root.querySelector<HTMLButtonElement>('button')!.click())
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
  })
})
