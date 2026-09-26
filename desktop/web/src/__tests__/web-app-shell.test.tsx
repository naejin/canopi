import { projectBrowserShellForTest } from './support/browser-shell-projection'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workspaceCanvasLifecycle = vi.hoisted(() => ({
  mounted: vi.fn(),
  unmounted: vi.fn(),
}))

vi.mock('../web/WebCanvasWorkspace', async () => {
  const { useEffect, useState } = await import('preact/hooks')
  return {
    WebCanvasWorkspace: () => {
      const [state, setState] = useState('0:none:100')
      useEffect(() => {
        workspaceCanvasLifecycle.mounted()
        return () => { workspaceCanvasLifecycle.unmounted() }
      }, [])
      return <button type="button" data-testid="web-workspace-canvas" onClick={() => setState('1:plant-1:125')}>{state}</button>
    },
  }
})

vi.mock('../components/panels/WorldMapPanel', () => ({
  WorldMapPanel: () => <div data-testid="web-templates-workspace" />,
}))
import { createMemoryDesignSessionStore } from '../app/document-session/store'
import { activePanel, navigateTo, sidePanel } from '../app/shell/state'
import { locale, theme } from '../app/settings/state'
import {
  installSettingsProjection,
  resetSettingsProjectionForTests,
} from '../app/settings/projection'
import type { Settings } from '../types/settings'
import { createBrowserAppDataStore, type BrowserStorageAdapter } from '../web/browser-app-data'
import { createBrowserDesignSessionController, type BrowserDesignFileAdapter } from '../web/browser-design-session'
import { BrowserAppShell } from '../web/BrowserAppShell'
import { WebApp } from '../web/WebApp'
import { SettingsDialog } from '../components/shared/SettingsDialog'
import { editDesignSessionForTest } from './support/design-session-edit'

function panelBarCommandIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-panel-rail] [data-command-id]'))
    .map((element) => element.dataset.commandId ?? '')
}

function panelBarLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[data-panel-rail] [data-command-id]'))
    .map((button) => button.getAttribute('aria-label') ?? '')
}

function panelBarButton(container: HTMLElement, id: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[data-panel-rail] [data-command-id="${id}"]`)
  if (!button) throw new Error(`Missing panel rail command ${id}`)
  return button
}

function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    locale: 'en',
    theme: 'light',
    snap_to_grid: true,
    snap_to_guides: true,
    side_panel_width: null,
    saved_stamps_frame_height: null,
    basemap_style: 'liberty',
    basemap_visible: true,
    basemap_opacity: 1,
    satellite_visible: false,
    satellite_opacity: 1,
    contour_visible: false,
    contour_opacity: 1,
    contour_interval: 0,
    hillshade_visible: false,
    hillshade_opacity: 0.55,
    plant_spacing_interval_m: 0.5,
    last_view: null,
    used_canvas_tools: [],
    tool_names_visible: null,
    ...overrides,
  }
}

function shellCommandProjection({
  templatesEnabled = false,
  downloadCanopiEnabled = true,
}: {
  readonly templatesEnabled?: boolean
  readonly downloadCanopiEnabled?: boolean
} = {}) {
  return projectBrowserShellForTest({
    currentPanel: activePanel.value,
    currentSidePanel: sidePanel.value,
    downloadCanopiEnabled,
    revertAvailable: false,
    geoJsonEnabled: downloadCanopiEnabled,
    templatesEnabled,
    capabilities: {
      newDesign: () => undefined,
      openCanopi: () => undefined,
      downloadCanopi: () => undefined,
      revertDesign: () => undefined,
      importGeoJson: () => undefined,
      exportGeoJson: () => undefined,
      navigate: navigateTo,
    },
  })
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
    workspaceCanvasLifecycle.mounted.mockClear()
    workspaceCanvasLifecycle.unmounted.mockClear()
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
      'file.rename',
      'file.downloadCanopi',
      'file.revert',
      'file.importGeoJson',
      'app.settings',
    ])
    expect(container.textContent).toContain('Open a .canopi file…')
    expect(container.textContent).toContain('Download a copy')
    expect(container.textContent).not.toContain('Quit')
    expect(container.querySelector('[data-testid="browser-drafts-list"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Open a .canopi file"]')).not.toBeNull()
    expect(panelBarCommandIds(container)).toEqual([
      'nav.layers',
      'nav.data',
      'nav.speciesKey',
      'nav.plantDb',
      'nav.favorites',
      'nav.calendar',
      'nav.budget',
      'nav.consortium',
    ])
  })

  it('matches desktop title-bar chrome for logo and settings controls', async () => {
    await act(async () => {
      render(<WebApp workspace={<div data-testid="stub-workspace" />} />, container)
    })

    expect(container.querySelector('img[alt="Canopi"]')).not.toBeNull()
    expect(Array.from(container.querySelectorAll('[data-menu-id]')).map((element) => element.textContent)).toEqual([
      'File', 'Edit', 'View', 'Tools', 'Help',
    ])
    expect(container.querySelector('button[aria-label="Keyboard shortcuts"]')?.getAttribute('aria-keyshortcuts')).toBe('F1')
    expect(container.querySelector('button[aria-label="Settings…"]')).not.toBeNull()
  })

  it('groups web-safe top bar commands in desktop-like menus', async () => {
    await act(async () => {
      render(<WebApp workspace={<div data-testid="stub-workspace" />} />, container)
    })

    expect(container.querySelector('[role="menubar"]')).not.toBeNull()
    expect(menuTrigger(container, 'file').textContent).toBe('File')

    await act(async () => {
      menuTrigger(container, 'file').click()
    })

    expect(openMenuCommandIds(container)).toEqual([
      'file.new',
      'file.openCanopi',
      'file.rename',
      'file.downloadCanopi',
      'file.revert',
      'file.importGeoJson',
      'app.settings',
    ])
  })

  it('dismisses open Web Edition menus on outside pointerup and Escape', async () => {
    await act(async () => {
      render(<BrowserAppShell commandProjection={shellCommandProjection()} />, container)
    })

    await act(async () => {
      menuTrigger(container, 'file').click()
    })
    expect(openMenuCommandIds(container)).toEqual([
      'file.new',
      'file.openCanopi',
      'file.rename',
      'file.downloadCanopi',
      'file.revert',
      'file.importGeoJson',
      'app.settings',
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
      render(<BrowserAppShell commandProjection={shellCommandProjection({ templatesEnabled: true })} />, container)
    })

    expect(panelBarCommandIds(container)).toContain('nav.templates')

    await act(async () => {
      panelBarButton(container, 'nav.templates').click()
    })

    expect(activePanel.value).toBe('templates')
    expect(sidePanel.value).toBeNull()
  })

  it('renders web-safe panel navigation in a desktop-style right PanelBar', async () => {
    await act(async () => {
      render(<BrowserAppShell commandProjection={shellCommandProjection({ templatesEnabled: true })} />, container)
    })

    expect(container.querySelector('[data-panel-rail]')).not.toBeNull()
    expect(panelBarCommandIds(container)).toEqual([
      'nav.canvas',
      'nav.templates',
      'nav.layers',
      'nav.data',
      'nav.speciesKey',
      'nav.plantDb',
      'nav.favorites',
      'nav.calendar',
      'nav.budget',
      'nav.consortium',
    ])
    expect(panelBarLabels(container)).toEqual([
      'Design canvas',
      'World Map',
      'Layers',
      'Data library',
      'Plants in this Design',
      'Plant catalog',
      'Favorites and stamps',
      'Calendar',
      'Budget',
      'Consortium',
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

    expect(container.querySelector('[data-workspace-composition]')?.getAttribute('data-workspace-sidebar-open')).toBeNull()

    await act(async () => {
      panelBarButton(container, 'nav.plantDb').click()
    })

    expect(container.querySelector('[data-workspace-composition]')).not.toBeNull()
    expect(container.querySelector('[data-workspace-composition]')?.getAttribute('data-workspace-sidebar-open')).toBe('true')
    expect(container.querySelector('[data-workspace-side-panel="plant-db"]')).not.toBeNull()
    expect(panelBarButton(container, 'nav.plantDb').getAttribute('aria-expanded')).toBe('true')

    await act(async () => {
      panelBarButton(container, 'nav.favorites').click()
    })

    expect(container.querySelector('[data-workspace-side-panel="plant-db"]')).toBeNull()
    expect(container.querySelector('[data-workspace-side-panel="favorites"]')).not.toBeNull()
    expect(panelBarButton(container, 'nav.favorites').getAttribute('aria-expanded')).toBe('true')

    await act(async () => {
      panelBarButton(container, 'nav.favorites').click()
    })

    expect(container.querySelector('[data-workspace-side-panel]')).toBeNull()
    expect(container.querySelector('[data-workspace-composition]')?.getAttribute('data-workspace-sidebar-open')).toBeNull()
    expect(panelBarButton(container, 'nav.favorites').getAttribute('aria-expanded')).toBe('false')
  })

  it('opens Budget and Consortium in the wider dock and every other panel at the default width', async () => {
    const store = createMemoryDesignSessionStore()
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore,
      fileAdapter: testFileAdapter(),
      now: () => new Date('2026-07-04T12:00:00.000Z'),
      createDraftId: () => 'draft-planning-panel-size',
    })
    await act(async () => { render(<WebApp controller={controller} />, container) })
    await clickShellCommand(container, 'file.new')

    await act(async () => { panelBarButton(container, 'nav.budget').click() })
    expect(container.querySelector('[data-workspace-side-panel="budget"]')).not.toBeNull()
    expect(container.querySelector('[data-dock-width]')?.getAttribute('data-dock-width')).toBe('wide')

    await act(async () => { panelBarButton(container, 'nav.plantDb').click() })
    expect(container.querySelector('[data-workspace-side-panel="plant-db"]')).not.toBeNull()
    expect(container.querySelector('[data-dock-width]')?.getAttribute('data-dock-width')).toBe('default')
  })

  it('preserves the canvas across side panels and releases it for the Templates primary route', async () => {
    const store = createMemoryDesignSessionStore()
    const controller = createBrowserDesignSessionController({
      store,
      appDataStore: createBrowserAppDataStore({ storage: memoryStorage() }),
      fileAdapter: testFileAdapter(),
      now: () => new Date('2026-07-04T12:00:00.000Z'),
      createDraftId: () => 'draft-workspace-routing',
    })
    await act(async () => { render(<WebApp controller={controller} templatesEnabled />, container) })
    await clickShellCommand(container, 'file.new')
    const canvas = container.querySelector<HTMLButtonElement>('[data-testid="web-workspace-canvas"]')
    if (!canvas) throw new Error('Missing Web workspace canvas')

    await act(async () => {
      canvas.focus()
      canvas.click()
      panelBarButton(container, 'nav.calendar').click()
    })
    expect(container.querySelector('[data-testid="web-workspace-canvas"]')).toBe(canvas)
    expect(canvas.textContent).toBe('1:plant-1:125')
    expect(workspaceCanvasLifecycle.mounted).toHaveBeenCalledOnce()
    expect(workspaceCanvasLifecycle.unmounted).not.toHaveBeenCalled()

    await act(async () => { panelBarButton(container, 'nav.budget').click() })
    expect(container.querySelector('[data-testid="web-workspace-canvas"]')).toBe(canvas)
    expect(canvas.textContent).toBe('1:plant-1:125')
    expect(workspaceCanvasLifecycle.unmounted).not.toHaveBeenCalled()

    await act(async () => { panelBarButton(container, 'nav.templates').click() })
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="web-templates-workspace"]')).not.toBeNull()
    })
    expect(container.querySelector('[data-testid="web-workspace-canvas"]')).toBeNull()
    expect(sidePanel.value).toBeNull()
    expect(workspaceCanvasLifecycle.unmounted).toHaveBeenCalledOnce()

    await act(async () => { panelBarButton(container, 'nav.canvas').click() })
    expect(container.querySelector('[data-testid="web-workspace-canvas"]')).not.toBeNull()
    expect(workspaceCanvasLifecycle.mounted).toHaveBeenCalledTimes(2)
  })

  it('keeps Location placement and address search out of browser chrome', async () => {
    await act(async () => {
      render(<BrowserAppShell commandProjection={shellCommandProjection()} />, container)
    })

    // Canopi v2 removed the Location tab: Designs are geolocated per object,
    // so the browser shell has no Location entry point and no geocoding.
    expect(panelBarCommandIds(container)).not.toContain('nav.location')
    expect(container.textContent).not.toContain('Design Location')
    expect(container.textContent).not.toContain('Search for a location')
    const emitted = container.innerHTML
    expect(emitted).not.toContain('ipc/geocoding')
    expect(emitted).not.toContain('@tauri-apps')
  })

  it('runs caller-ready shell command projections without local dispatch policy', async () => {
    const capabilities = {
      newDesign: vi.fn(),
      openCanopi: vi.fn(),
      downloadCanopi: vi.fn(),
      revertDesign: vi.fn(),
      importGeoJson: vi.fn(),
      exportGeoJson: vi.fn(),
      navigate: vi.fn(),
    }
    const commandProjection = projectBrowserShellForTest({
      currentPanel: 'canvas',
      currentSidePanel: null,
      downloadCanopiEnabled: true,
      revertAvailable: false,
      geoJsonEnabled: true,
      templatesEnabled: false,
      capabilities,
    })
    await act(async () => {
      render(<BrowserAppShell commandProjection={commandProjection} />, container)
    })

    await clickShellCommand(container, 'file.new')
    await clickShellCommand(container, 'file.openCanopi')
    await clickShellCommand(container, 'file.downloadCanopi')
    await clickShellCommand(container, 'file.importGeoJson')
    await clickShellCommand(container, 'file.exportGeoJson')
    await act(async () => {
      panelBarButton(container, 'nav.plantDb').click()
      panelBarButton(container, 'nav.favorites').click()
    })

    expect(capabilities.newDesign).toHaveBeenCalledOnce()
    expect(capabilities.openCanopi).toHaveBeenCalledOnce()
    expect(capabilities.downloadCanopi).toHaveBeenCalledOnce()
    expect(capabilities.importGeoJson).toHaveBeenCalledOnce()
    expect(capabilities.exportGeoJson).toHaveBeenCalledOnce()
    expect(capabilities.navigate.mock.calls).toEqual([
      ['plant-db'],
      ['favorites'],
    ])
  })

  it('persists the browser theme command through the Settings Projection', async () => {
    const persistSettings = vi.fn<(settings: Settings) => Promise<void>>().mockResolvedValue(undefined)
    installSettingsProjection({
      load: () => baseSettings(),
      save: persistSettings,
    })

    await act(async () => {
      render(<BrowserAppShell commandProjection={shellCommandProjection()} />, container)
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
      render(<><BrowserAppShell commandProjection={shellCommandProjection()} /><SettingsDialog /></>, container)
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
      const titleButton = container.querySelector<HTMLButtonElement>('button[aria-label^="Rename Design: "]')
      if (!titleButton) throw new Error('Missing rename title button')
      titleButton.click()
    })
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('input[aria-label="Design name"]')
      if (!input) throw new Error('Missing rename title input')
      input.value = 'Terrace Garden'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('input[aria-label="Design name"]')
      if (!input) throw new Error('Missing rename title input')
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    })

    expect(store.readDesignName()).toBe('Terrace Garden')
    expect(store.readCurrentDesign()?.name).toBe('Terrace Garden')
    expect(container.querySelector('button[aria-label^="Rename Design: "]')?.textContent).toBe('Terrace Garden')
    await act(async () => {
      await controller.continuousSave.flush()
    })
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
    expect(commandButton(container, 'file.downloadCanopi').getAttribute('aria-disabled')).toBe('true')

    await clickShellCommand(container, 'file.new')

    await openCommandMenu(container, 'file.downloadCanopi')
    const download = commandButton(container, 'file.downloadCanopi')
    expect(download.getAttribute('aria-disabled')).toBeNull()

    await act(async () => {
      download.click()
    })

    expect(fileAdapter.downloadCanopiFile).toHaveBeenCalledOnce()
  })

  it('shows the active Browser Design identity and continuous-save status in the top bar', async () => {
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

    expect(container.querySelector('button[aria-label^="Rename Design: "]')).toBeNull()
    expect(container.querySelector('[data-save-status]')).toBeNull()

    await clickShellCommand(container, 'file.new')

    expect(container.querySelector('button[aria-label^="Rename Design: "]')?.textContent).toBe('Untitled Design')
    expect(container.querySelector('[data-save-status] [role="status"]')?.textContent).toBe('Saved in this browser')
    expect(container.querySelector('[data-save-status] button')?.textContent).toBe('Download a copy')

    storage.failWrites = true
    await act(async () => {
      editDesignSessionForTest(store, (design) => ({ ...design, description: 'Browser edit' }))
    })
    expect(container.querySelector('[data-save-status] [role="status"]')?.textContent).toBe('Saved in this browser')

    await act(async () => {
      await controller.continuousSave.flush()
    })
    const status = container.querySelector('[data-save-status]')
    expect(status?.getAttribute('data-save-status')).toBe('error')
    expect(status?.querySelector('[role="alert"]')?.textContent).toBe('Couldn’t save')

    storage.failWrites = false
    await act(async () => {
      status?.querySelector('button')?.click()
      await Promise.resolve()
    })
    await act(async () => {
      Array.from(status?.querySelectorAll<HTMLButtonElement>('[role="dialog"] button') ?? [])
        .find((button) => button.textContent === 'Retry')?.click()
      await Promise.resolve()
    })
    await act(async () => {
      await controller.continuousSave.flush()
    })
    expect(container.querySelector('[data-save-status] [role="status"]')?.textContent).toBe('Saved in this browser')
    expect(appDataStore.loadDraft('draft-identity-state')?.description).toBe('Browser edit')
  })
})

async function clickShellCommand(container: HTMLElement, id: string): Promise<void> {
  await openCommandMenu(container, id)
  if (id === 'file.exportGeoJson' || id === 'file.exportCanvasPdf') await openExportSubmenu(container)
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

/** Export ▸ items live in a submenu; hovering its parent opens it. */
async function openExportSubmenu(container: HTMLElement): Promise<void> {
  await act(async () => {
    container.querySelector('[data-submenu-id="submenu.export"]')!
      .parentElement!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  })
}

function menuIdForCommand(id: string): string | null {
  if (id.startsWith('file.') || id === 'app.settings') return 'file'
  if (id.startsWith('view.')) return 'view'
  return null
}

async function clickThemeControl(container: HTMLElement): Promise<void> {
  await clickShellCommand(container, 'view.toggleTheme')
}

async function selectLocale(container: HTMLElement, code: string): Promise<void> {
  const names: Record<string, string> = { fr: 'Français', en: 'English' }
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="Settings…"]')!.click()
  })
  await act(async () => {
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.getAttribute('aria-haspopup') === 'listbox')!.click()
  })
  const option = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="option"]'))
    .find((button) => button.textContent === names[code])
  if (!option) throw new Error(`Missing locale option ${code}`)
  await act(async () => {
    option.click()
  })
}

function commandButton(container: HTMLElement, id: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[data-menu-popup="root"] [data-command-id="${id}"]`)
  if (!button) throw new Error(`Missing command ${id}`)
  return button
}

function menuTrigger(container: HTMLElement, id: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[data-menu-id="${id}"]`)
  if (!button) throw new Error(`Missing menu ${id}`)
  return button
}

function openMenuCommandIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-menu-popup="root"] [data-menu-root-item][data-command-id]'))
    .map((element) => element.dataset.commandId ?? '')
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
