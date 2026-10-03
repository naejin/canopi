import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale, singleKeyShortcuts, theme, toolNamesVisible, usedCanvasTools } from '../app/settings/state'
import {
  closeKeyboardShortcutsDialog,
  closeSettingsDialog,
  keyboardShortcutsDialogOpen,
  openKeyboardShortcutsDialog,
  openSettingsDialog,
  settingsDialogOpen,
} from '../app/shell/dialogs'
import { createWorkspaceShellCapabilities } from '../app/workspace-commands/capabilities'
import { mapLayers, createDefaultMapLayers, mapBackgroundOf } from '../app/map-layers/state'
import { aboutCanopiDialogOpen } from '../app/about/state'
import { designRenameRequest } from '../app/shell/requests'
import { sidePanel } from '../app/shell/state'
import type { MenuDefinition } from '../app/shell-commands/menus'
import { SettingsDialog } from '../components/shared/SettingsDialog'
import { KeyboardShortcutsDialog } from '../components/shared/KeyboardShortcutsDialog'

describe('Settings dialog', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    locale.value = 'en'
    theme.value = 'light'
    usedCanvasTools.value = []
    toolNamesVisible.value = null
  })

  afterEach(() => {
    closeSettingsDialog()
    render(null, container)
    container.remove()
    locale.value = 'en'
    theme.value = 'light'
    toolNamesVisible.value = null
  })

  it('opens as a modal with Appearance: theme, language and tool names', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    await act(async () => { render(<SettingsDialog />, container) })
    expect(container.innerHTML).toBe('')

    await act(async () => { openSettingsDialog() })
    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.textContent).toContain('Settings')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close')

    const dark = [...dialog.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((radio) => radio.textContent === 'Dark')!
    await act(async () => { dark.click() })
    expect(theme.value).toBe('dark')

    const toolNames = dialog.querySelector<HTMLInputElement>('input[role="switch"]')!
    expect(toolNames.checked).toBe(true)
    await act(async () => { toolNames.click() })
    expect(toolNamesVisible.value).toBe(false)

    await act(async () => {
      dialog.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!.click()
    })
    const francais = [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((option) => option.textContent === 'Français')!
    await act(async () => { francais.click() })
    expect(locale.value).toBe('fr')
    expect(container.querySelector('[role="dialog"]')!.textContent).toContain('Réglages')

    await act(async () => {
      container.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(settingsDialogOpen.value).toBe(false)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('keeps Tab inside the dialog and closes on a backdrop press', async () => {
    await act(async () => { render(<SettingsDialog />, container) })
    await act(async () => { openSettingsDialog() })
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')]
    focusable.at(-1)!.focus()
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })) })
    expect(document.activeElement).toBe(focusable[0])
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })) })
    expect(document.activeElement).toBe(focusable.at(-1))

    const overlay = dialog.parentElement!
    await act(async () => { overlay.dispatchEvent(new Event('pointerup', { bubbles: true })) })
    expect(settingsDialogOpen.value).toBe(false)
  })

  it('stays open when a press inside the dialog is released on the backdrop', async () => {
    await act(async () => { render(<SettingsDialog />, container) })
    await act(async () => { openSettingsDialog() })
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const overlay = dialog.parentElement!
    // A drag that starts in a field (selecting its text) and ends on the backdrop.
    await act(async () => {
      dialog.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      overlay.dispatchEvent(new Event('pointerup', { bubbles: true }))
    })
    expect(settingsDialogOpen.value).toBe(true)
    // A press that starts and ends on the backdrop closes.
    await act(async () => {
      overlay.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      overlay.dispatchEvent(new Event('pointerup', { bubbles: true }))
    })
    expect(settingsDialogOpen.value).toBe(false)
  })
})

describe('Keyboard shortcuts dialog', () => {
  let container: HTMLDivElement
  const menus: MenuDefinition[] = [
    {
      id: 'tools',
      label: 'Tools',
      items: [{ type: 'action', id: 'select', label: 'Select', shortcut: 'V', disabled: false, action: vi.fn() }],
    },
    {
      id: 'file',
      label: 'File',
      items: [
        { type: 'action', id: 'new', label: 'New Design', shortcut: 'Ctrl N', disabled: false, action: vi.fn() },
        { type: 'action', id: 'revert', label: 'Revert…', disabled: false, action: vi.fn() },
      ],
    },
    { id: 'help', label: 'Help', items: [{ type: 'action', id: 'about', label: 'About', disabled: false, action: vi.fn() }] },
  ]
  /** The View menu as composeWorkspaceMenus builds it: its rotation rows come from the canvas commands. */
  const viewMenu: MenuDefinition = {
    id: 'view',
    label: 'View',
    items: [
      { type: 'action', id: 'view.fitToDesign', label: 'Fit to Design', shortcut: 'Shift F', disabled: false, action: vi.fn() },
      { type: 'action', id: 'view.resetNorth', label: 'Reset north', shortcut: 'N', disabled: false, action: vi.fn() },
      { type: 'action', id: 'view.turnViewLeft', label: 'Turn view left 15°', shortcut: 'Shift ←', disabled: false, action: vi.fn() },
      { type: 'action', id: 'view.turnViewRight', label: 'Turn view right 15°', shortcut: 'Shift →', disabled: false, action: vi.fn() },
      { type: 'action', id: 'canvas.toggleGrid', label: 'Grid', shortcut: 'Shift G', disabled: false, action: vi.fn() },
    ],
  }

  beforeEach(() => {
    locale.value = 'en'
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    closeKeyboardShortcutsDialog()
    render(null, container)
    container.remove()
  })

  it('lists every menu command that has a shortcut, grouped by menu, from the menus themselves', async () => {
    await act(async () => { render(<KeyboardShortcutsDialog menus={menus} />, container) })
    expect(container.innerHTML).toBe('')
    await act(async () => { openKeyboardShortcutsDialog() })

    const sections = [...container.querySelectorAll('section section')]
    expect(sections.map((section) => section.querySelector('h3')?.textContent)).toEqual([
      'Tools (anywhere except text fields)',
      'File',
      'Map and workspace',
    ])
    expect(sections[1]!.textContent).toBe('FileNew DesignCtrl N')
    // Keys that are not menu commands: regions, nudges, map pans and turning a stamp.
    expect([...sections[2]!.querySelectorAll('dt')].map((row) => row.textContent)).toEqual([
      'Next area: title bar, tools, map, panel',
      'Previous area',
      'Nudge the selection 10 cm',
      'Nudge the selection 1 m',
      'Pan the map when nothing is selected',
      'Pan the map farther when nothing is selected',
      'Turn the stamp you are placing by 15°',
    ])
    expect([...sections[2]!.querySelectorAll('dd')].map((row) => row.textContent)).toEqual([
      'F6', 'Shift F6', 'Arrow keys', 'Ctrl Arrow keys', 'Arrow keys', 'Ctrl Arrow keys', '[ ]',
    ])
    expect(container.textContent).toContain('Esc does one thing at a time')
    expect(document.activeElement?.textContent).toBe('Close')

    await act(async () => { (document.activeElement as HTMLButtonElement).click() })
    expect(keyboardShortcutsDialogOpen.value).toBe(false)
  })

  it('shows static rotation rows in View instead of the menu\'s, and that Shift N always resets north', async () => {
    await act(async () => { render(<KeyboardShortcutsDialog menus={[...menus, viewMenu]} />, container) })
    await act(async () => { openKeyboardShortcutsDialog() })
    const viewRows = () => {
      const section = [...container.querySelectorAll('section section')].find((candidate) => candidate.querySelector('h3')?.textContent === 'View')!
      return [...section.querySelectorAll('dl > div')].map((row) => [row.querySelector('dt')!.textContent, row.querySelector('dd')!.textContent])
    }

    expect(viewRows()).toEqual([
      ['Fit to Design', 'Shift F'],
      ['Turn the view 15°', 'Shift ← · Shift →'],
      ['Reset north', 'N · Shift N · Shift ↑'],
      ['Grid', 'Shift G'],
    ])
    const footnote = () => container.querySelector('[data-single-key-shortcuts]')!.textContent
    expect(footnote()).toContain('Shift N works even when single-key shortcuts are off.')
    // With the switch off, N is gone from the menus and from the static row; the note stays.
    await act(async () => { singleKeyShortcuts.value = false })
    try {
      expect(viewRows()).toContainEqual(['Reset north', 'Shift N · Shift ↑'])
      expect(footnote()).toContain('Shift N works even when single-key shortcuts are off.')
    } finally {
      singleKeyShortcuts.value = true
    }
  })

  it('says where single-key shortcuts are turned off, and that they are off', async () => {
    await act(async () => { render(<KeyboardShortcutsDialog menus={menus} />, container) })
    await act(async () => { openKeyboardShortcutsDialog() })
    const footnote = () => container.querySelector('[data-single-key-shortcuts]')!
    expect(footnote().textContent).toBe('Tool keys work anywhere except text fields. Single-key shortcuts can be turned off in Settings › Keyboard. Shift N works even when single-key shortcuts are off.')
    await act(async () => { singleKeyShortcuts.value = false })
    try {
      expect(footnote().getAttribute('data-single-key-shortcuts')).toBe('off')
      expect(footnote().textContent).toBe('Single-key shortcuts are off. Turn them on in Settings › Keyboard. Shift N works even when single-key shortcuts are off.')
    } finally {
      singleKeyShortcuts.value = true
    }
  })
})

describe('Workspace shell capabilities', () => {
  beforeEach(() => {
    mapLayers.value = createDefaultMapLayers()
    theme.value = 'light'
  })

  it('switches the map background, theme, dialogs and rename through app state only', async () => {
    const capabilities = createWorkspaceShellCapabilities()

    capabilities.showSatellite.execute()
    expect(mapBackgroundOf(mapLayers.value)).toBe('satellite')
    expect(capabilities.showSatellite.isChecked()).toBe(true)
    expect(capabilities.showMap.isChecked()).toBe(false)
    capabilities.showNoBackground.execute()
    expect(mapBackgroundOf(mapLayers.value)).toBe('none')
    capabilities.showMap.execute()
    expect(mapBackgroundOf(mapLayers.value)).toBe('basemap')
    expect(capabilities.showNoBackground.isChecked()).toBe(false)

    capabilities.toggleTheme.execute()
    expect(theme.value).toBe('dark')
    expect(capabilities.toggleTheme.isChecked()).toBe(true)

    capabilities.aboutCanopi.execute()
    expect(aboutCanopiDialogOpen.value).toBe(true)
    aboutCanopiDialogOpen.value = false

    const rename = designRenameRequest.value
    expect(capabilities.renameDesign.isExecutionDisabled({ hasDesign: false, revertAvailable: false, activePanel: 'canvas', sidePanel: null })).toBe(true)
    capabilities.renameDesign.execute()
    expect(designRenameRequest.value).toBe(rename + 1)

    sidePanel.value = null
    capabilities.findPlants.execute()
    expect(sidePanel.value).toBe('plant-db')
    // Find plants focuses the catalog's finder on the next frame; let that frame run here.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    sidePanel.value = null
  })
})
