import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerFocusRegion } from '../app/shell/focus-regions'
import { installDesktopKeys } from './support/desktop-key-router'
import { holdModalLayer } from '../app/shell/modal-layer'

describe('F6 focus regions', () => {
  let releases: (() => void)[]
  let keys: ReturnType<typeof installDesktopKeys>
  let titleBar: HTMLElement
  let menu: HTMLButtonElement
  let rail: HTMLElement
  let railTool: HTMLButtonElement
  let map: HTMLElement
  let dock: HTMLElement
  let dockField: HTMLInputElement

  function region(tag: string, html: string): HTMLElement {
    const element = document.createElement(tag)
    element.innerHTML = html
    document.body.append(element)
    return element
  }

  function press(shiftKey = false, target: EventTarget = document.activeElement ?? document.body): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'F6', shiftKey, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
  }

  beforeEach(() => {
    titleBar = region('header', '<button>File</button><button>Edit</button>')
    menu = titleBar.querySelector('button')!
    // The tool rail keeps one tab stop (roving tabindex): the active tool.
    rail = region('div', '<button tabindex="-1">Select</button><button tabindex="0">Polygon zone</button>')
    railTool = rail.querySelectorAll('button')[1]!
    map = region('div', '')
    map.tabIndex = 0
    dock = region('aside', '<button>Close panel</button><input aria-label="Find plants">')
    dockField = dock.querySelector('input')!
    releases = [
      // Registered out of order: the cycle follows title bar, tools, map, panel.
      registerFocusRegion('dock', dock),
      registerFocusRegion('map', map),
      registerFocusRegion('title-bar', titleBar),
      registerFocusRegion('tool-rail', rail),
    ]
    // F6 runs in the key router's capture listener (app/keyboard/key-router.ts).
    keys = installDesktopKeys()
  })

  afterEach(() => {
    keys.dispose()
    for (const release of releases) release()
    document.body.innerHTML = ''
  })

  it('cycles the title bar, tool rail, map and open panel with F6, and back with Shift F6', () => {
    map.focus()
    const event = press()
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(dock.querySelector('button'))
    press()
    expect(document.activeElement).toBe(menu)
    press()
    expect(document.activeElement).toBe(railTool)
    press()
    expect(document.activeElement).toBe(map)

    press(true)
    expect(document.activeElement).toBe(railTool)
    press(true)
    expect(document.activeElement).toBe(menu)
    press(true)
    expect(document.activeElement).toBe(dock.querySelector('button'))
  })

  it('returns to the control last focused in a region', () => {
    dockField.focus()
    press()
    expect(document.activeElement).toBe(menu)
    press(true)
    expect(document.activeElement).toBe(dockField)
  })

  it('starts at the title bar from outside every region and skips a closed panel', () => {
    releases.shift()!()
    dock.remove()
    document.body.focus()
    press()
    expect(document.activeElement).toBe(menu)
    map.focus()
    press()
    expect(document.activeElement).toBe(menu)
  })

  it('stands aside while a dialog is open, and for Ctrl or Alt F6', () => {
    map.focus()
    const release = holdModalLayer()
    try {
      expect(press().defaultPrevented).toBe(false)
      expect(document.activeElement).toBe(map)
    } finally {
      release()
    }
    map.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', ctrlKey: true, bubbles: true }))
    expect(document.activeElement).toBe(map)
  })
})
