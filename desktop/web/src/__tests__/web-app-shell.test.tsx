import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDesignSessionStore } from '../app/document-session/store'
import { activePanel, sidePanel } from '../app/shell/state'
import { locale, theme } from '../app/settings/state'
import {
  installSettingsProjection,
  resetSettingsProjectionForTests,
} from '../app/settings/projection'
import type { Settings } from '../types/settings'
import { createBrowserAppDataStore, type BrowserStorageAdapter } from '../web/browser-app-data'
import { createBrowserDesignSessionController, type BrowserDesignFileAdapter } from '../web/browser-design-session'
import { BrowserAppShell, type BrowserShellCommandHandlers } from '../web/BrowserAppShell'
import { WebApp } from '../web/WebApp'
import { editDesignSessionForTest } from './support/design-session-edit'

function commandIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-web-command-id]'))
    .map((element) => element.dataset.webCommandId ?? '')
}

function panelBarCommandIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-web-panelbar-command-id]'))
    .map((element) => element.dataset.webPanelbarCommandId ?? '')
}

function panelBarLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[data-web-panelbar-command-id]'))
    .map((button) => button.getAttribute('aria-label') ?? '')
}

function panelBarButton(container: HTMLElement, id: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[data-web-panelbar-command-id="${id}"]`)
  if (!button) throw new Error(`Missing panel bar command ${id}`)
  return button
}

function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    locale: 'en',
    theme: 'light',
    snap_to_grid: true,
    snap_to_guides: true,
    auto_save_interval_s: 60,
    side_panel_width: null,
    saved_stamps_frame_height: null,
    bottom_panel_open: false,
    bottom_panel_timeline_height: null,
    bottom_panel_budget_height: null,
    bottom_panel_consortium_height: null,
    bottom_panel_tab: 'budget',
    map_layer_visible: true,
    map_style: 'street',
    map_opacity: 1,
    contour_visible: false,
    contour_opacity: 1,
    contour_interval: 0,
    hillshade_visible: false,
    hillshade_opacity: 0.55,
    plant_spacing_interval_m: 0.5,
    ...overrides,
  }
}

describe('Web Edition Browser App Shell', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    activePanel.value = 'canvas'
    sidePanel.value = null
    locale.value = 'en'
    theme.value = 'light'
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    resetSettingsProjectionForTests()
  })

  it('renders the browser command set without desktop-only chrome or commands', async () => {
    await act(async () => {
      render(<WebApp workspace={<div data-testid="stub-workspace" />} />, container)
    })

    expect(container.querySelector('[data-testid="browser-app-shell"]')).not.toBeNull()
    await act(async () => {
      menuTrigger(container, 'file').click()
    })
    expect(openMenuCommandIds(container)).toEqual([
      'file.new',
      'file.openCanopi',
      'file.downloadCanopi',
    ])
    expect(container.textContent).toContain('Open .canopi')
    expect(container.textContent).toContain('Download .canopi')
    expect(container.querySelector('[data-testid="browser-drafts-list"]')).toBeNull()
    expect(container.querySelector('[data-web-locale-control]')?.textContent).toContain('EN')
    expect(container.querySelector('[data-web-theme-control]')).not.toBeNull()
    expect(panelBarCommandIds(container)).toEqual([
      'nav.canvas',
      'nav.plantDb',
      'nav.favorites',
    ])
  })

  it('matches desktop title-bar chrome for logo and settings controls', async () => {
    await act(async () => {
      render(<WebApp workspace={<div data-testid="stub-workspace" />} />, container)
    })

    expect(container.querySelector('img[alt="Canopi"]')).not.toBeNull()
    expect(Array.from(container.querySelectorAll('[data-web-menu-id]')).map((element) => element.textContent)).toEqual([
      'File',
    ])
    expect(container.querySelector('[data-web-locale-control]')?.textContent).toContain('EN')
    expect(container.querySelector<HTMLButtonElement>('[data-web-theme-control]')).not.toBeNull()
  })

  it('groups web-safe top bar commands in desktop-like menus', async () => {
    await act(async () => {
      render(<WebApp workspace={<div data-testid="stub-workspace" />} />, container)
    })

    expect(container.querySelector('[role="menubar"]')).not.toBeNull()
    expect(menuTrigger(container, 'file').textContent).toBe('File')
    expect(container.querySelector('[data-web-locale-control]')?.textContent).toContain('EN')
    expect(container.querySelector('[data-web-theme-control]')).not.toBeNull()

    await act(async () => {
      menuTrigger(container, 'file').click()
    })

    expect(openMenuCommandIds(container)).toEqual([
      'file.new',
      'file.openCanopi',
      'file.downloadCanopi',
    ])
  })

  it('dismisses open Web Edition menus on outside pointerup and Escape', async () => {
    await act(async () => {
      render(<BrowserAppShell />, container)
    })

    await act(async () => {
      menuTrigger(container, 'file').click()
    })
    expect(openMenuCommandIds(container)).toEqual([
      'file.new',
      'file.openCanopi',
      'file.downloadCanopi',
    ])

    await act(async () => {
      document.dispatchEvent(new Event('pointerup', { bubbles: true }))
    })
    expect(openMenuCommandIds(container)).toEqual([])

    await act(async () => {
      menuTrigger(container, 'file').click()
    })
    expect(openMenuCommandIds(container)).toContain('file.new')

    await act(async () => {
      menuTrigger(container, 'file').dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Escape',
      }))
    })
    expect(openMenuCommandIds(container)).toEqual([])
  })

  it('shows the templates entry point only when static templates are configured', async () => {
    await act(async () => {
      render(<BrowserAppShell templatesEnabled />, container)
    })

    expect(commandIds(container)).toContain('nav.templates')

    await act(async () => {
      clickCommand(container, 'nav.templates')
    })

    expect(activePanel.value).toBe('templates')
    expect(sidePanel.value).toBeNull()
  })

  it('renders web-safe panel navigation in a desktop-style right PanelBar', async () => {
    await act(async () => {
      render(<BrowserAppShell templatesEnabled />, container)
    })

    expect(container.querySelector('[data-testid="web-panel-bar"]')).not.toBeNull()
    expect(panelBarCommandIds(container)).toEqual([
      'nav.canvas',
      'nav.templates',
      'nav.plantDb',
      'nav.favorites',
    ])
    expect(panelBarLabels(container)).toEqual([
      'Design Canvas',
      'World Map',
      'Plant Database',
      'Favorites',
    ])
    await act(async () => {
      panelBarButton(container, 'nav.plantDb').click()
    })

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')
  })

  it('opens switches and closes Web side panels beside the right PanelBar', async () => {
    const store = createMemoryDesignSessionStore()
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      now: () => new Date('2026-07-04T12:00:00.000Z'),
      createDraftId: () => 'draft-side-panel-state',
    })

    await act(async () => {
      render(
        <WebApp
          controller={controller}
        />,
        container,
      )
    })

    expect(container.querySelector('[data-web-workspace-with-sidebar]')?.getAttribute('data-web-sidebar-open')).toBeNull()

    await act(async () => {
      panelBarButton(container, 'nav.plantDb').click()
    })

    expect(container.querySelector('[data-web-workspace-with-sidebar]')).not.toBeNull()
    expect(container.querySelector('[data-web-workspace-with-sidebar]')?.getAttribute('data-web-sidebar-open')).toBe('true')
    expect(container.querySelector('[data-web-side-panel="plant-db"]')).not.toBeNull()
    expect(panelBarButton(container, 'nav.plantDb').getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      panelBarButton(container, 'nav.favorites').click()
    })

    expect(container.querySelector('[data-web-side-panel="plant-db"]')).toBeNull()
    expect(container.querySelector('[data-web-side-panel="favorites"]')).not.toBeNull()
    expect(panelBarButton(container, 'nav.favorites').getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      panelBarButton(container, 'nav.favorites').click()
    })

    expect(container.querySelector('[data-web-side-panel]')).toBeNull()
    expect(container.querySelector('[data-web-workspace-with-sidebar]')?.getAttribute('data-web-sidebar-open')).toBeNull()
    expect(panelBarButton(container, 'nav.favorites').getAttribute('aria-pressed')).toBe('false')
  })

  it('omits the Web Location feature from browser chrome', async () => {
    await act(async () => {
      render(<BrowserAppShell />, container)
    })

    expect(commandIds(container)).not.toContain('nav.location')
    expect(panelBarCommandIds(container)).not.toContain('nav.location')
    expect(container.textContent).not.toContain('Design Location')
    expect(container.querySelector('[data-testid="web-location-workspace"]')).toBeNull()
  })

  it('routes shell commands through command handlers and browser-safe app state', async () => {
    const handlers: BrowserShellCommandHandlers = {
      newDesign: vi.fn(),
      openCanopi: vi.fn(),
      downloadCanopi: vi.fn(),
    }
    await act(async () => {
      render(<BrowserAppShell handlers={handlers} />, container)
    })

    await clickShellCommand(container, 'file.new')
    await clickShellCommand(container, 'file.openCanopi')
    await clickShellCommand(container, 'file.downloadCanopi')
    await clickThemeControl(container)
    await selectLocale(container, 'fr')
    await act(async () => {
      clickCommand(container, 'nav.plantDb')
      clickCommand(container, 'nav.favorites')
      clickCommand(container, 'nav.canvas')
    })

    expect(handlers.newDesign).toHaveBeenCalledOnce()
    expect(handlers.openCanopi).toHaveBeenCalledOnce()
    expect(handlers.downloadCanopi).toHaveBeenCalledOnce()
    expect(theme.value).toBe('dark')
    expect(locale.value).toBe('fr')
    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBeNull()
  })

  it('persists the browser theme command through the Settings Projection', async () => {
    const persistSettings = vi.fn<(settings: Settings) => Promise<void>>().mockResolvedValue(undefined)
    installSettingsProjection({
      load: () => baseSettings(),
      save: persistSettings,
    })

    await act(async () => {
      render(<BrowserAppShell />, container)
    })
    await clickThemeControl(container)

    expect(persistSettings).toHaveBeenCalledOnce()
    expect(persistSettings).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'en',
      theme: 'dark',
    }))
  })

  it('persists the browser locale command through the Settings Projection', async () => {
    const persistSettings = vi.fn<(settings: Settings) => Promise<void>>().mockResolvedValue(undefined)
    installSettingsProjection({
      load: () => baseSettings(),
      save: persistSettings,
    })

    await act(async () => {
      render(<BrowserAppShell />, container)
    })
    await selectLocale(container, 'fr')

    expect(persistSettings).toHaveBeenCalledOnce()
    expect(persistSettings).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'fr',
      theme: 'light',
    }))
  })

  it('renames the active Browser Design from the top bar like desktop', async () => {
    const store = createMemoryDesignSessionStore()
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      now: () => new Date('2026-07-04T12:00:00.000Z'),
      createDraftId: () => 'draft-rename-state',
    })

    await act(async () => {
      render(
        <WebApp
          controller={controller}
          workspace={<div data-testid="stub-workspace" />}
        />,
        container,
      )
    })
    await clickShellCommand(container, 'file.new')

    await act(async () => {
      const titleButton = container.querySelector<HTMLButtonElement>('[data-web-design-title-button]')
      if (!titleButton) throw new Error('Missing rename title button')
      titleButton.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('[data-web-design-title-input]')
      if (!input) throw new Error('Missing rename title input')
      input.value = 'Terrace Garden'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('[data-web-design-title-input]')
      if (!input) throw new Error('Missing rename title input')
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    })

    expect(store.readDesignName()).toBe('Terrace Garden')
    expect(store.readCurrentDesign()?.name).toBe('Terrace Garden')
    expect(container.querySelector('[data-web-design-title]')?.textContent).toBe('Terrace Garden')
    expect(appDataStore.listDrafts()[0]?.name).toBe('Terrace Garden')
  })

  it('enables Download .canopi only after a Browser Design is active', async () => {
    const store = createMemoryDesignSessionStore()
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const fileAdapter = testFileAdapter()
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter,
      now: () => new Date('2026-07-04T12:00:00.000Z'),
      createDraftId: () => 'draft-download-state',
    })

    await act(async () => {
      render(
        <WebApp
          controller={controller}
          workspace={<div data-testid="stub-workspace" />}
        />,
        container,
      )
    })

    await openCommandMenu(container, 'file.downloadCanopi')
    expect(commandButton(container, 'file.downloadCanopi').disabled).toBe(true)

    await clickShellCommand(container, 'file.new')

    await openCommandMenu(container, 'file.downloadCanopi')
    const download = commandButton(container, 'file.downloadCanopi')
    expect(download.disabled).toBe(false)

    await act(async () => {
      download.click()
    })

    expect(fileAdapter.downloadCanopiFile).toHaveBeenCalledOnce()
  })

  it('shows the active Browser Design identity and dirty state in the top bar', async () => {
    const store = createMemoryDesignSessionStore()
    const storage = memoryStorage()
    const appDataStore = createBrowserAppDataStore({ storage })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      now: () => new Date('2026-07-04T12:00:00.000Z'),
      createDraftId: () => 'draft-identity-state',
    })

    await act(async () => {
      render(
        <WebApp
          controller={controller}
          workspace={<div data-testid="stub-workspace" />}
        />,
        container,
      )
    })

    expect(container.querySelector('[data-web-design-title]')?.textContent).toBe('Canopi')

    await clickShellCommand(container, 'file.new')

    expect(container.querySelector('[data-web-design-title]')?.textContent).toBe('Untitled Design')
    expect(container.querySelector('[data-web-design-dirty]')).toBeNull()

    storage.failWrites = true
    await act(async () => {
      editDesignSessionForTest(store, (design) => ({ ...design, description: 'Browser edit' }))
    })

    expect(container.querySelector('[data-web-design-title]')?.textContent).toBe('Untitled Design')
    expect(container.querySelector('[data-web-design-dirty]')).not.toBeNull()
  })
})

function clickCommand(container: HTMLElement, id: string): void {
  ensureCommandMenuOpen(container, id)
  commandButton(container, id).click()
}

async function clickShellCommand(container: HTMLElement, id: string): Promise<void> {
  await openCommandMenu(container, id)
  await act(async () => {
    commandButton(container, id).click()
  })
}

async function openCommandMenu(container: HTMLElement, id: string): Promise<void> {
  await act(async () => {
    ensureCommandMenuOpen(container, id)
  })
}

function ensureCommandMenuOpen(container: HTMLElement, id: string): void {
  const menuId = menuIdForCommand(id)
  if (!menuId) return
  const trigger = menuTrigger(container, menuId)
  if (trigger.getAttribute('aria-expanded') !== 'true') {
    trigger.click()
  }
}

function menuIdForCommand(id: string): string | null {
  if (id.startsWith('file.')) return 'file'
  return null
}

async function clickThemeControl(container: HTMLElement): Promise<void> {
  await act(async () => {
    commandButton(container, 'settings.theme').click()
  })
}

async function selectLocale(container: HTMLElement, code: string): Promise<void> {
  const picker = container.querySelector<HTMLElement>('[data-web-locale-control]')
  if (!picker) throw new Error('Missing locale control')
  await act(async () => {
    picker.querySelector<HTMLButtonElement>('button')?.click()
  })
  const option = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'))
    .find((button) => button.textContent === code.toUpperCase())
  if (!option) throw new Error(`Missing locale option ${code}`)
  await act(async () => {
    option.click()
  })
}

function commandButton(container: HTMLElement, id: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[data-web-command-id="${id}"]`)
  if (!button) throw new Error(`Missing command ${id}`)
  return button
}

function menuTrigger(container: HTMLElement, id: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[data-web-menu-id="${id}"]`)
  if (!button) throw new Error(`Missing menu ${id}`)
  return button
}

function openMenuCommandIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-web-menu-open="true"] [data-web-command-id]'))
    .map((element) => element.dataset.webCommandId ?? '')
}

interface MemoryStorage extends BrowserStorageAdapter {
  failWrites: boolean
}

function memoryStorage(): MemoryStorage {
  const values = new Map<string, string>()
  return {
    failWrites: false,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      if (this.failWrites) throw new Error('storage unavailable')
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }
}

function testFileAdapter(): BrowserDesignFileAdapter {
  return {
    openCanopiFile: vi.fn(async () => null),
    downloadCanopiFile: vi.fn(async () => undefined),
  }
}
