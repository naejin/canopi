import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale } from '../app/settings/state'
import {
  closeRotateSelectionDialog,
  openRotateSelectionDialog,
  parseRotationDegrees,
  rotateSelectionDialog,
} from '../app/rotate-selection/state'
import { RotateSelectionDialog } from '../components/canvas/RotateSelectionDialog'

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('Rotate… dialog', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    locale.value = 'en'
  })

  afterEach(() => {
    rotateSelectionDialog.value = null
    render(null, container)
    container.remove()
    locale.value = 'en'
  })

  it('reads typed angles in degrees, with a comma, a minus sign or a degree sign', () => {
    expect(parseRotationDegrees('30')).toBe(30)
    expect(parseRotationDegrees(' -15 ')).toBe(-15)
    expect(parseRotationDegrees('−45')).toBe(-45)
    expect(parseRotationDegrees('12,5')).toBe(12.5)
    expect(parseRotationDegrees('90°')).toBe(90)
    expect(parseRotationDegrees('')).toBeNull()
    expect(parseRotationDegrees('ten')).toBeNull()
    expect(parseRotationDegrees('1e3')).toBeNull()
  })

  it('rotates by the typed angle on Enter and hands focus back', async () => {
    const rotate = vi.fn()
    const returnFocus = vi.fn()
    await act(async () => { render(<RotateSelectionDialog />, container) })
    expect(container.innerHTML).toBe('')

    await act(async () => { openRotateSelectionDialog({ rotate, returnFocus }) })
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.textContent).toContain('Rotate selection')
    const angle = dialog.querySelector<HTMLInputElement>('input')!
    expect(document.activeElement).toBe(angle)
    expect(angle.getAttribute('inputmode')).toBe('decimal')
    expect(angle.getAttribute('aria-describedby')).toBeTruthy()

    await act(async () => { typeInto(angle, '30') })
    await act(async () => { angle.form!.requestSubmit() })

    expect(rotate).toHaveBeenCalledWith(30)
    expect(returnFocus).toHaveBeenCalledOnce()
    expect(rotateSelectionDialog.value).toBeNull()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('steps the angle by 15° with its buttons', async () => {
    const rotate = vi.fn()
    await act(async () => { render(<RotateSelectionDialog />, container) })
    await act(async () => { openRotateSelectionDialog({ rotate }) })
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const angle = dialog.querySelector<HTMLInputElement>('input')!
    const clockwise = dialog.querySelector<HTMLButtonElement>('[data-rotate-step="15"]')!
    const counter = dialog.querySelector<HTMLButtonElement>('[data-rotate-step="-15"]')!
    expect(clockwise.getAttribute('aria-label')).toBe('Add 15°')
    expect(counter.getAttribute('aria-label')).toBe('Subtract 15°')

    await act(async () => { clockwise.click() })
    await act(async () => { clockwise.click() })
    await act(async () => { counter.click() })
    expect(angle.value).toBe('15')
    const apply = [...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Rotate')!
    await act(async () => { apply.click() })

    expect(rotate).toHaveBeenCalledWith(15)
  })

  it('keeps the dialog open and says why when the angle is not a number', async () => {
    const rotate = vi.fn()
    await act(async () => { render(<RotateSelectionDialog />, container) })
    await act(async () => { openRotateSelectionDialog({ rotate }) })
    const angle = container.querySelector<HTMLInputElement>('input')!

    await act(async () => { typeInto(angle, 'ten') })
    await act(async () => { angle.form!.requestSubmit() })

    expect(rotate).not.toHaveBeenCalled()
    expect(angle.getAttribute('aria-invalid')).toBe('true')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Type an angle in degrees, such as 45 or -30.')
    expect(document.activeElement).toBe(angle)
  })

  it('closes on Escape without rotating', async () => {
    const rotate = vi.fn()
    const returnFocus = vi.fn()
    await act(async () => { render(<RotateSelectionDialog />, container) })
    await act(async () => { openRotateSelectionDialog({ rotate, returnFocus }) })
    const angle = container.querySelector<HTMLInputElement>('input')!

    await act(async () => {
      angle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(rotate).not.toHaveBeenCalled()
    expect(returnFocus).toHaveBeenCalledOnce()
    expect(rotateSelectionDialog.value).toBeNull()
    closeRotateSelectionDialog()
    expect(returnFocus).toHaveBeenCalledOnce()
  })

  it('shows a stepped angle with the interface language decimals', async () => {
    locale.value = 'fr'
    await act(async () => { render(<RotateSelectionDialog />, container) })
    await act(async () => { openRotateSelectionDialog({ rotate: vi.fn() }) })
    const angle = container.querySelector<HTMLInputElement>('input')!
    await act(async () => { typeInto(angle, '7,5') })
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-rotate-step="15"]')!.click() })

    expect(angle.value).toBe('22,5')
  })
})
