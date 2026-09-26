import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale, theme, toolNamesVisible, usedCanvasTools } from '../app/settings/state'
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
      'Tools (while the map has focus)',
      'File',
    ])
    expect(sections[1]!.textContent).toBe('FileNew DesignCtrl N')
    expect(container.textContent).toContain('Esc does one thing at a time')
    expect(document.activeElement?.textContent).toBe('Close')

    await act(async () => { (document.activeElement as HTMLButtonElement).click() })
    expect(keyboardShortcutsDialogOpen.value).toBe(false)
  })
})

describe('Workspace shell capabilities', () => {
  beforeEach(() => {
    mapLayers.value = createDefaultMapLayers()
    theme.value = 'light'
  })

  it('switches the map background, theme, dialogs and rename through app state only', () => {
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
    sidePanel.value = null
  })
})
