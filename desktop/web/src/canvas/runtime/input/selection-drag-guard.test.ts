// Adapted from GeoLibre tests/selection-drag-guard.test.ts at commit b3d91de (Copyright (c) 2026 Qiusheng Wu, MIT
// License; see THIRD_PARTY_NOTICES.md), with the map host's DOM source around the guard.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DomInputSourceDeps } from '../interaction-ports'
import { createDomInputSource } from './dom-input-source'
import { installSelectionDragGuard } from './selection-drag-guard'

let host: HTMLDivElement
let page: HTMLParagraphElement

beforeEach(() => {
  page = document.createElement('p')
  page.textContent = 'Plant list beside the map'
  host = document.createElement('div')
  host.innerHTML = '<canvas></canvas><textarea data-canvas-text-entry>Note</textarea>'
  document.body.append(page, host)
})

afterEach(() => {
  document.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
})

function deps(): DomInputSourceDeps {
  return {
    host,
    platform: { os: 'linux', gestureEvents: false },
    timers: { set: vi.fn(() => 1), clear: vi.fn() },
  }
}

function selectPageText(): Selection {
  const selection = document.getSelection()!
  const range = document.createRange()
  range.selectNodeContents(page)
  selection.removeAllRanges()
  selection.addRange(range)
  expect(selection.isCollapsed).toBe(false)
  return selection
}

function press(target: Element, button = 0): PointerEvent {
  const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button, buttons: 1 }) as PointerEvent
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } })
  target.dispatchEvent(event)
  return event
}

function dispatch(target: Element, type: 'dragstart' | 'selectstart'): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

describe('the selection-drag guard on the map host', () => {
  it('a drag that leaves the map selects no text', () => {
    const dispose = createDomInputSource(deps()).attach(() => {})
    const canvas = host.querySelector('canvas')!
    const selection = selectPageText()

    // The press on the map collapses a leftover selection, so WebKit cannot start a drag of it ...
    press(canvas)
    expect(selection.isCollapsed).toBe(true)
    // ... and neither a native drag nor a new text selection starts from the map while the drag runs off it.
    expect(dispatch(canvas, 'dragstart').defaultPrevented).toBe(true)
    expect(dispatch(canvas, 'selectstart').defaultPrevented).toBe(true)
    dispose()

    // Detached, the map leaves the page its own behaviour.
    selectPageText()
    press(canvas)
    expect(document.getSelection()!.isCollapsed).toBe(false)
    expect(dispatch(canvas, 'selectstart').defaultPrevented).toBe(false)
  })

  it('text fields keep their selection', () => {
    const dispose = createDomInputSource(deps()).attach(() => {})
    const note = host.querySelector('textarea')!
    const field = document.createElement('input')
    field.value = 'Malus domestica'
    document.body.append(field)
    field.setSelectionRange(0, 5)

    // A press in the note editor keeps the page's selection, and selecting or dragging its own text works.
    const selection = selectPageText()
    press(note)
    expect(selection.isCollapsed).toBe(false)
    expect(dispatch(note, 'selectstart').defaultPrevented).toBe(false)
    expect(dispatch(note, 'dragstart').defaultPrevented).toBe(false)
    // A press on the map leaves a field's own selection alone.
    press(host.querySelector('canvas')!)
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 5])
    dispose()
  })
})

describe('installSelectionDragGuard', () => {
  function fakeSelection(collapsed: boolean): { isCollapsed: boolean; cleared: number; removeAllRanges(): void } {
    const selection = {
      isCollapsed: collapsed,
      cleared: 0,
      removeAllRanges() {
        selection.cleared += 1
        selection.isCollapsed = true
      },
    }
    return selection
  }

  function dragStartFrom(draggable: string | null): Event {
    const event = new Event('dragstart', { cancelable: true })
    Object.defineProperty(event, 'target', {
      value: { getAttribute: (name: string) => (name === 'draggable' ? draggable : null) },
    })
    return event
  }

  const pointerDown = (button: number): Event => Object.assign(new Event('pointerdown', { cancelable: true }), { button })
  const never = (): boolean => false

  it('collapses an active selection on a primary press, and leaves a collapsed one and other buttons alone', () => {
    const container = new EventTarget()
    const selection = fakeSelection(false)
    installSelectionDragGuard(container, never, () => selection)
    container.dispatchEvent(pointerDown(2))
    expect(selection.cleared).toBe(0)
    container.dispatchEvent(pointerDown(0))
    expect(selection.cleared).toBe(1)
    container.dispatchEvent(pointerDown(0))
    expect(selection.cleared).toBe(1)
  })

  it('cancels the implicit native drag but honours draggable=true, in any case and inside a shadow root', () => {
    const container = new EventTarget()
    installSelectionDragGuard(container, never, () => null)
    for (const [draggable, prevented] of [[null, true], ['true', false], ['TRUE', false]] as const) {
      const event = dragStartFrom(draggable)
      container.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(prevented)
    }

    const draggableInShadow = { getAttribute: (name: string) => (name === 'draggable' ? 'true' : null) }
    const shadowHost = { getAttribute: () => null }
    const retargeted = new Event('dragstart', { cancelable: true })
    Object.defineProperty(retargeted, 'target', { value: shadowHost })
    Object.defineProperty(retargeted, 'composedPath', { value: () => [draggableInShadow, shadowHost, container] })
    container.dispatchEvent(retargeted)
    expect(retargeted.defaultPrevented).toBe(false)
  })

  it('removes its listeners on dispose', () => {
    const container = new EventTarget()
    const selection = fakeSelection(false)
    const dispose = installSelectionDragGuard(container, never, () => selection)
    dispose()

    container.dispatchEvent(pointerDown(0))
    const drag = dragStartFrom(null)
    container.dispatchEvent(drag)
    const select = new Event('selectstart', { cancelable: true })
    container.dispatchEvent(select)

    expect(selection.cleared).toBe(0)
    expect(drag.defaultPrevented).toBe(false)
    expect(select.defaultPrevented).toBe(false)
  })
})
