import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale, theme } from '../app/settings/state'
import {
  closeKeyboardShortcutsDialog,
  closeSettingsDialog,
  keyboardShortcutsDialogOpen,
  openKeyboardShortcutsDialog,
  openSettingsDialog,
} from '../app/shell/dialogs'
import { cycleFocusRegion } from '../app/shell/focus-regions'
import { modalLayerOpen } from '../app/shell/modal-layer'
import { sidePanel, activePanel } from '../app/shell/state'
import { closeSaveViewDialog, openSaveViewDialog } from '../app/saved-views'
import { closeAboutCanopiDialog, openAboutCanopiDialog } from '../app/about/state'
import { answerSaveProblem, requestSaveProblemDecision } from '../app/document-session/save-problem'
import { AboutCanopiDialog } from '../components/shared/AboutCanopiDialog'
import { SaveProblemDialog } from '../components/shared/SaveProblemDialog'
import type { MenuDefinition } from '../app/shell-commands/menus'
import { setCurrentCanvasSession } from '../canvas/session'
import { createSessionPlane } from '../canvas/session-plane'
import { commandPaletteOpen, handleAppCommandKeyDown } from '../commands/registry'
import { CommandPalette } from '../components/shared/CommandPalette'
import { KeyboardShortcutsDialog } from '../components/shared/KeyboardShortcutsDialog'
import { PanelRail } from '../components/shared/PanelRail'
import { SavedViewDialogs } from '../components/shared/SavedViewDialogs'
import { SettingsDialog } from '../components/shared/SettingsDialog'
import { WorkspaceTitleBar } from '../components/shared/WorkspaceTitleBar'
import type { CanopiFile } from '../types/design'
import { createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { replaceCurrentDesignState } from './support/design-session-state'
import { TEST_GEO_ORIGIN } from './support/geo-design'

const MENUS: readonly MenuDefinition[] = [
  { id: 'file', label: 'File', items: [{ type: 'action', id: 'file.new', label: 'New', disabled: false, action: vi.fn() }] },
  { id: 'view', label: 'View', items: [{ type: 'action', id: 'view.fit', label: 'Fit', disabled: false, action: vi.fn() }] },
]

const COMMAND = { label: 'Command', action: vi.fn() }

function design(): CanopiFile {
  return {
    version: 9,
    name: 'Orchard',
    description: null,
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    views: [],
    stories: [],
    created_at: '',
    updated_at: '',
    extra: {},
  }
}

function Workspace() {
  return (
    <>
      <WorkspaceTitleBar menus={MENUS} help={COMMAND} settings={COMMAND} />
      <PanelRail label="Panels" groups={[[{ panel: 'layers', label: 'Layers', disabled: false, action: vi.fn() }]]} />
      <SettingsDialog />
      {keyboardShortcutsDialogOpen.value && <KeyboardShortcutsDialog menus={MENUS} />}
      <SavedViewDialogs />
      <AboutCanopiDialog />
      <SaveProblemDialog />
    </>
  )
}

const DIALOGS = [
  { name: 'Settings', open: openSettingsDialog, close: closeSettingsDialog },
  { name: 'Keyboard shortcuts', open: openKeyboardShortcutsDialog, close: closeKeyboardShortcutsDialog },
  { name: 'Save current view', open: openSaveViewDialog, close: closeSaveViewDialog },
  { name: 'About Canopi', open: openAboutCanopiDialog, close: closeAboutCanopiDialog },
  { name: 'the save problem dialog', open: () => { void requestSaveProblemDecision({ kind: 'revert' }) }, close: () => answerSaveProblem('cancel') },
] as const

describe('Modal layer', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    theme.value = 'light'
    activePanel.value = 'canvas'
    sidePanel.value = null
    replaceCurrentDesignState(design(), null, 'Orchard')
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: createTestCanvasQuerySurface({ sessionPlane: createSessionPlane(TEST_GEO_ORIGIN) }),
    }))
  })

  afterEach(() => {
    for (const dialog of DIALOGS) dialog.close()
    commandPaletteOpen.value = false
    render(null, container)
    container.remove()
    setCurrentCanvasSession(null)
  })

  for (const dialog of DIALOGS) {
    it(`makes the title bar and rails inert behind ${dialog.name}, then gives focus back`, async () => {
      await act(async () => { render(<Workspace />, container) })
      const titleBar = container.querySelector<HTMLElement>('[data-workspace-title-bar]')!
      const rail = container.querySelector<HTMLElement>('[data-panel-rail]')!
      const view = titleBar.querySelector<HTMLButtonElement>('button[data-menu-id="view"]')!
      expect(titleBar.hasAttribute('inert')).toBe(false)
      expect(modalLayerOpen.value).toBe(false)

      view.focus()
      await act(async () => { dialog.open() })
      const modal = container.querySelector('[aria-modal="true"]')!
      expect(modal).not.toBeNull()
      expect(modalLayerOpen.value).toBe(true)
      expect(titleBar.hasAttribute('inert')).toBe(true)
      expect(rail.hasAttribute('inert')).toBe(true)
      expect(modal.closest('[inert]')).toBeNull()

      // Neither a press nor the menubar's keys open a menu under the dialog.
      await act(async () => { view.click() })
      expect(container.querySelector('[role="menu"]')).toBeNull()
      for (const key of ['Enter', 'ArrowDown', 'ArrowUp', ' ']) {
        await act(async () => {
          view.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
        })
      }
      expect(container.querySelector('[role="menu"]')).toBeNull()
      expect(view.getAttribute('aria-expanded')).toBe('false')

      // Nor does a workspace shortcut reach the Design under it.
      expect(handleAppCommandKeyDown(new KeyboardEvent('keydown', { key: '3', ctrlKey: true }))).toBe(false)
      expect(sidePanel.value).toBeNull()

      await act(async () => { dialog.close() })
      expect(modalLayerOpen.value).toBe(false)
      expect(titleBar.hasAttribute('inert')).toBe(false)
      expect(rail.hasAttribute('inert')).toBe(false)
      expect(document.activeElement).toBe(view)

      await act(async () => { view.click() })
      expect(container.querySelector('[role="menu"]')).not.toBeNull()
    })
  }

  it('makes the command palette modal: chrome inert, shortcuts stand down, focus returns', async () => {
    await act(async () => { render(<><Workspace /><CommandPalette /></>, container) })
    const titleBar = container.querySelector<HTMLElement>('[data-workspace-title-bar]')!
    const view = titleBar.querySelector<HTMLButtonElement>('button[data-menu-id="view"]')!
    const toggle = () => new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, cancelable: true })

    view.focus()
    await act(async () => { expect(handleAppCommandKeyDown(toggle())).toBe(true) })
    const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!
    expect(commandPaletteOpen.value).toBe(true)
    expect(modalLayerOpen.value).toBe(true)
    expect(titleBar.hasAttribute('inert')).toBe(true)
    expect(input.closest('[inert]')).toBeNull()
    expect(document.activeElement).toBe(input)

    // A shell shortcut typed into the palette does not reach the Design.
    expect(handleAppCommandKeyDown(new KeyboardEvent('keydown', { key: '3', ctrlKey: true }))).toBe(false)
    expect(sidePanel.value).toBeNull()
    // F6 stays inside the palette.
    expect(cycleFocusRegion(1)).toBe(false)

    // The toggle still closes it, and focus goes back to the control that opened it.
    await act(async () => { expect(handleAppCommandKeyDown(toggle())).toBe(true) })
    expect(commandPaletteOpen.value).toBe(false)
    expect(modalLayerOpen.value).toBe(false)
    expect(titleBar.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(view)

    // Escape from the palette's field closes it the same way.
    await act(async () => { handleAppCommandKeyDown(toggle()) })
    await act(async () => {
      container.querySelector<HTMLInputElement>('[role="combobox"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(commandPaletteOpen.value).toBe(false)
    expect(document.activeElement).toBe(view)
  })

  it('closes an open menu when a dialog opens over it', async () => {
    await act(async () => { render(<Workspace />, container) })
    const view = container.querySelector<HTMLButtonElement>('button[data-menu-id="view"]')!
    await act(async () => { view.click() })
    expect(container.querySelector('[role="menu"]')).not.toBeNull()
    await act(async () => { openSettingsDialog() })
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })

  it('stays open while a second dialog is still open', async () => {
    await act(async () => { render(<Workspace />, container) })
    const titleBar = container.querySelector<HTMLElement>('[data-workspace-title-bar]')!
    await act(async () => { openSettingsDialog(); openKeyboardShortcutsDialog() })
    await act(async () => { closeSettingsDialog() })
    expect(titleBar.hasAttribute('inert')).toBe(true)
    await act(async () => { closeKeyboardShortcutsDialog() })
    expect(titleBar.hasAttribute('inert')).toBe(false)
  })
})
