import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createTestView, type TestView } from '../../../__tests__/support/test-view'
import { CANVAS_CHROME_FONT_FAMILY } from '../../chrome-fonts'
import type { CanvasFocusPort } from '../app-adapter'
import type { TextEntryRequest } from '../tools/tool'
import { createTextEntryHost, type TextEntryHost } from './text-entry-host'

const NOTE: TextEntryRequest = {
  anchor: { x: 10, y: 20 },
  rotationDeg: 30,
  initialText: 'Pond edge\nwet',
  placeholderKey: 'canvas.textNote.placeholder',
  mode: 'edit',
  fontSizePx: 20,
}
const NEW_NOTE: TextEntryRequest = {
  anchor: { x: 30, y: 40 },
  rotationDeg: 0,
  initialText: '',
  placeholderKey: 'canvas.textNote.placeholder',
  mode: 'create',
}

let container: HTMLDivElement
let view: TestView
let focusMap: Mock<CanvasFocusPort['focusMap']>
let host: TextEntryHost | null = null

function mount(): TextEntryHost {
  container = document.createElement('div')
  document.body.appendChild(container)
  view = createTestView({ viewport: { x: 5, y: 7, scale: 2 } })
  focusMap = vi.fn<CanvasFocusPort['focusMap']>(() => container.focus())
  container.tabIndex = 0
  host = createTextEntryHost({
    container,
    frames: view.frames,
    translate: (key) => `t:${key}`,
    focus: { focusMap },
  })
  return host
}

function entry(): HTMLTextAreaElement | null {
  return container.querySelector<HTMLTextAreaElement>('textarea')
}

function key(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

afterEach(() => {
  host?.dispose()
  host = null
  view?.dispose()
  container?.remove()
})

describe('the text-entry host', () => {
  it('opens a new-note field at its anchor with today\'s look, focused on the next frame', async () => {
    const entries = mount()

    entries.open(NEW_NOTE, () => 'close')

    const textarea = entry()!
    expect(entries.isOpen()).toBe(true)
    expect(textarea.hasAttribute('data-canvas-text-entry')).toBe(true)
    expect(textarea.hasAttribute('data-annotation-inline-editor')).toBe(false)
    expect(textarea.placeholder).toBe('t:canvas.textNote.placeholder')
    expect(textarea.getAttribute('aria-label')).toBe('t:canvas.tools.text')
    expect(textarea.style.left).toBe('65px')
    expect(textarea.style.top).toBe('87px')
    expect(textarea.style.fontSize).toBe('var(--text-base)')
    expect(textarea.style.lineHeight).toBe('1.4')
    expect(textarea.style.transform).toBe('')
    expect(textarea.style.fontFamily.replace(/"/g, "'")).toBe(CANVAS_CHROME_FONT_FAMILY)
    expect(document.activeElement).not.toBe(textarea)

    await nextAnimationFrame()
    expect(document.activeElement).toBe(textarea)
  })

  it('opens a note\'s in-place editor at the note, sized by its text, turned by its rotation, all selected', async () => {
    const entries = mount()
    const select = vi.spyOn(HTMLTextAreaElement.prototype, 'select')

    entries.open(NOTE, () => 'close')

    const textarea = entry()!
    expect(textarea.value).toBe('Pond edge\nwet')
    expect(textarea.dataset.annotationInlineEditor).toBe('true')
    expect(textarea.dataset.preserveOverlays).toBe('true')
    expect(textarea.hasAttribute('data-canvas-text-entry')).toBe(true)
    expect(textarea.placeholder).toBe('')
    expect(textarea.style.left).toBe('25px')
    expect(textarea.style.top).toBe('47px')
    expect(textarea.style.fontSize).toBe('20px')
    expect(textarea.style.lineHeight).toBe('1.25')
    // Nine characters at 0.6 em and two lines at 1.25 em, as the note is drawn.
    expect(textarea.style.width).toBe('120px')
    expect(textarea.style.minHeight).toBe('54px')
    expect(textarea.style.transform).toBe('rotate(30deg)')
    expect(textarea.style.transformOrigin).toBe('top left')

    await nextAnimationFrame()
    expect(document.activeElement).toBe(textarea)
    expect(select).toHaveBeenCalled()
    select.mockRestore()
  })

  it('follows the camera frame', () => {
    const entries = mount()
    entries.open(NEW_NOTE, () => 'close')

    view.setViewport({ x: 100, y: 50, scale: 1 })

    expect(entry()!.style.left).toBe('130px')
    expect(entry()!.style.top).toBe('90px')
  })

  it('Enter submits the text: a closed entry returns focus to the map, a kept one stays the same field', async () => {
    const entries = mount()
    const submit = vi.fn<(text: string) => 'close' | 'keep'>(() => 'keep')
    entries.open(NEW_NOTE, submit)
    const textarea = entry()!
    await nextAnimationFrame()
    textarea.value = 'Willow'

    const shiftEnter = key(textarea, { key: 'Enter', shiftKey: true })
    expect(shiftEnter.defaultPrevented).toBe(false)
    expect(submit).not.toHaveBeenCalled()

    const refused = key(textarea, { key: 'Enter' })
    expect(refused.defaultPrevented).toBe(true)
    expect(submit).toHaveBeenLastCalledWith('Willow')
    expect(entry()).toBe(textarea)
    expect(entries.isOpen()).toBe(true)

    submit.mockReturnValue('close')
    key(textarea, { key: 'Enter' })
    expect(entry()).toBeNull()
    expect(entries.isOpen()).toBe(false)
    expect(focusMap).toHaveBeenCalledWith('text-entry-closed')
  })

  it('a blur submits at once, so a press on the map finds the entry already committed', async () => {
    const entries = mount()
    const submit = vi.fn<(text: string) => 'close' | 'keep'>(() => 'keep')
    entries.open(NEW_NOTE, submit)
    const textarea = entry()!
    await nextAnimationFrame()
    textarea.value = 'Hazel'

    container.focus()
    expect(submit).toHaveBeenCalledWith('Hazel')
    expect(entries.isOpen()).toBe(true)

    textarea.focus()
    submit.mockReturnValue('close')
    container.focus()
    expect(entries.isOpen()).toBe(false)
    expect(entry()).toBeNull()
    expect(submit).toHaveBeenCalledTimes(2)
  })

  it('Esc is the entry\'s own: it closes without submitting and never reaches the map', async () => {
    const entries = mount()
    const submit = vi.fn(() => 'close' as const)
    const mapKeys = vi.fn()
    container.addEventListener('keydown', mapKeys)
    entries.open(NOTE, submit)
    const textarea = entry()!
    await nextAnimationFrame()

    const escape = key(textarea, { key: 'Escape' })

    expect(escape.defaultPrevented).toBe(true)
    expect(mapKeys).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
    expect(entries.isOpen()).toBe(false)
    expect(focusMap).toHaveBeenCalledWith('text-entry-closed')
  })

  it('close() discards the entry without submitting, and moves focus only when the entry held it', () => {
    const entries = mount()
    const submit = vi.fn(() => 'close' as const)
    entries.open(NEW_NOTE, submit)

    entries.close()

    expect(submit).not.toHaveBeenCalled()
    expect(entry()).toBeNull()
    expect(focusMap).not.toHaveBeenCalled()
  })

  it('a new request submits the open entry first, and a refused one keeps it open', async () => {
    const entries = mount()
    const first = vi.fn<(text: string) => 'close' | 'keep'>(() => 'keep')
    const second = vi.fn<(text: string) => 'close' | 'keep'>(() => 'close')
    entries.open(NOTE, first)
    const kept = entry()!

    entries.open(NEW_NOTE, second)
    expect(first).toHaveBeenCalledWith('Pond edge\nwet')
    expect(entry()).toBe(kept)

    first.mockReturnValue('close')
    entries.open(NEW_NOTE, second)
    expect(container.querySelectorAll('textarea')).toHaveLength(1)
    expect(entry()).not.toBe(kept)
    expect(entry()!.hasAttribute('data-annotation-inline-editor')).toBe(false)
  })

  it('the same note asked again keeps its field and selects its text', async () => {
    const entries = mount()
    const submit = vi.fn(() => 'close' as const)
    entries.open(NOTE, submit)
    const textarea = entry()!
    const select = vi.spyOn(textarea, 'select')

    entries.open({ ...NOTE }, submit)

    expect(submit).not.toHaveBeenCalled()
    expect(entry()).toBe(textarea)
    expect(document.activeElement).toBe(textarea)
    expect(select).toHaveBeenCalled()
  })

  it('dispose discards the entry and stops following the camera', () => {
    const entries = mount()
    const submit = vi.fn(() => 'close' as const)
    entries.open(NEW_NOTE, submit)
    const textarea = entry()!

    entries.dispose()
    host = null
    view.setViewport({ x: 100, y: 50, scale: 1 })

    expect(submit).not.toHaveBeenCalled()
    expect(textarea.isConnected).toBe(false)
    expect(textarea.style.left).toBe('65px')
  })
})
