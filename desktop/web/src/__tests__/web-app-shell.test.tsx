import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDesignSessionStore } from '../app/document-session/store'
import { activePanel, sidePanel } from '../app/shell/state'
import { locale, theme } from '../app/settings/state'
import { createBrowserAppDataStore, type BrowserStorageAdapter } from '../web/browser-app-data'
import { createBrowserDesignSessionController, type BrowserDesignFileAdapter } from '../web/browser-design-session'
import { BrowserAppShell, type BrowserShellCommandHandlers } from '../web/BrowserAppShell'
import { WebApp } from '../web/WebApp'

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
      'drafts.open',
    ])
    expect(container.textContent).toContain('Open .canopi')
    expect(container.textContent).toContain('Download .canopi')
    expect(container.textContent).toContain('Drafts')
    await act(async () => {
      menuTrigger(container, 'settings').click()
    })
    expect(openMenuCommandIds(container)).toEqual([
      'settings.language',
      'settings.theme',
    ])
    expect(panelBarCommandIds(container)).toEqual([
      'nav.canvas',
      'nav.location',
      'nav.plantDb',
      'nav.favorites',
    ])
    expect(panelBarCommandIds(container)).not.toContain('nav.templates')
    expect(container.textContent).not.toContain('Design Notebook')
    expect(container.textContent).not.toContain('Problem Report')
    expect(container.textContent).not.toContain('Save As')
    expect(container.textContent).not.toContain('Exit')
  })

  it('omits desktop-only and deferred surfaces from rendered Web Edition chrome', async () => {
    await act(async () => {
      render(<BrowserAppShell templatesEnabled />, container)
    })
    await act(async () => {
      menuTrigger(container, 'file').click()
    })
    const fileMenuText = container.textContent ?? ''
    await act(async () => {
      menuTrigger(container, 'settings').click()
    })
    const renderedChrome = `${fileMenuText} ${container.textContent ?? ''}`
    const forbiddenLabels = [
      'Save',
      'Save As',
      'Open Recent',
      'Reveal',
      'Update',
      'Problem Report',
      'Design Notebook',
      'Timeline',
      'Budget',
      'Consortium',
      'Export',
      'Geocode',
      'Site Adaptation',
      'Display by',
      'Color by',
    ]

    for (const label of forbiddenLabels) {
      expect(renderedChrome).not.toContain(label)
    }
    expect(panelBarCommandIds(container)).not.toContain('nav.designNotebook')
  })

  it('groups web-safe top bar commands in desktop-like menus', async () => {
    await act(async () => {
      render(<WebApp workspace={<div data-testid="stub-workspace" />} />, container)
    })

    expect(container.querySelector('[role="menubar"]')).not.toBeNull()
    expect(menuTrigger(container, 'file').textContent).toBe('File')
    expect(menuTrigger(container, 'settings').textContent).toBe('Settings')

    await act(async () => {
      menuTrigger(container, 'file').click()
    })

    expect(openMenuCommandIds(container)).toEqual([
      'file.new',
      'file.openCanopi',
      'file.downloadCanopi',
      'drafts.open',
    ])

    await act(async () => {
      menuTrigger(container, 'settings').click()
    })

    expect(openMenuCommandIds(container)).toEqual([
      'settings.language',
      'settings.theme',
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
      'drafts.open',
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
      'nav.location',
      'nav.templates',
      'nav.plantDb',
      'nav.favorites',
    ])
    expect(panelBarLabels(container)).toEqual([
      'Design Canvas',
      'Design Location',
      'World Map',
      'Plant Database',
      'Favorites',
    ])
    expect(panelBarCommandIds(container)).not.toContain('nav.designNotebook')

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
          appDataStore={appDataStore}
        />,
        container,
      )
    })

    await act(async () => {
      panelBarButton(container, 'nav.plantDb').click()
    })

    expect(container.querySelector('[data-web-workspace-with-sidebar]')).not.toBeNull()
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
    expect(panelBarButton(container, 'nav.favorites').getAttribute('aria-pressed')).toBe('false')
  })

  it('routes shell commands through command handlers and browser-safe app state', async () => {
    const handlers: BrowserShellCommandHandlers = {
      newDesign: vi.fn(),
      openCanopi: vi.fn(),
      downloadCanopi: vi.fn(),
      openDrafts: vi.fn(),
    }
    const onSettingsChange = vi.fn()

    await act(async () => {
      render(<BrowserAppShell handlers={handlers} onSettingsChange={onSettingsChange} />, container)
    })

    await clickShellCommand(container, 'file.new')
    await clickShellCommand(container, 'file.openCanopi')
    await clickShellCommand(container, 'file.downloadCanopi')
    await clickShellCommand(container, 'drafts.open')
    await clickShellCommand(container, 'settings.theme')
    await clickShellCommand(container, 'settings.language')
    await act(async () => {
      clickCommand(container, 'nav.plantDb')
      clickCommand(container, 'nav.favorites')
      clickCommand(container, 'nav.location')
      clickCommand(container, 'nav.canvas')
    })

    expect(handlers.newDesign).toHaveBeenCalledOnce()
    expect(handlers.openCanopi).toHaveBeenCalledOnce()
    expect(handlers.downloadCanopi).toHaveBeenCalledOnce()
    expect(handlers.openDrafts).toHaveBeenCalledOnce()
    expect(onSettingsChange).toHaveBeenLastCalledWith({ locale: 'fr', theme: 'dark' })
    expect(theme.value).toBe('dark')
    expect(locale.value).toBe('fr')
    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBeNull()
  })

  it('shows a simple Browser Drafts list without notebook affordances', async () => {
    const handlers: BrowserShellCommandHandlers = {
      openDraft: vi.fn(),
      openDrafts: vi.fn(),
    }

    await act(async () => {
      render(
        <BrowserAppShell
          handlers={handlers}
          drafts={[
            {
              id: 'draft-terrace',
              name: 'Terrace Draft',
              updatedAt: '2026-07-04T12:00:00.000Z',
            },
          ]}
        />,
        container,
      )
    })

    await clickShellCommand(container, 'drafts.open')

    expect(handlers.openDrafts).toHaveBeenCalledOnce()
    expect(container.querySelector('[data-testid="browser-drafts-list"]')).not.toBeNull()
    expect(container.textContent).toContain('Browser Drafts')
    expect(container.textContent).toContain('Stored in this browser')
    expect(container.textContent).toContain('Download .canopi')
    expect(container.textContent).toContain('Terrace Draft')
    expect(container.textContent).not.toContain('Design Notebook')
    expect(container.textContent).not.toContain('Section')
    expect(container.textContent).not.toContain('Reveal')

    await act(async () => {
      const draftButton = container.querySelector<HTMLButtonElement>('[data-browser-draft-id="draft-terrace"]')
      if (!draftButton) throw new Error('draft row should render')
      draftButton.click()
    })

    expect(handlers.openDraft).toHaveBeenCalledWith('draft-terrace')
  })

  it('loads and saves browser-local settings through WebApp', async () => {
    const appDataStore = createBrowserAppDataStore({ storage: memoryStorage() })

    await act(async () => {
      render(<WebApp appDataStore={appDataStore} workspace={<div data-testid="stub-workspace" />} />, container)
    })
    await clickShellCommand(container, 'settings.theme')
    await clickShellCommand(container, 'settings.language')

    render(null, container)
    theme.value = 'light'
    locale.value = 'en'

    await act(async () => {
      render(<WebApp appDataStore={appDataStore} workspace={<div data-testid="stub-workspace" />} />, container)
    })

    expect(theme.value).toBe('dark')
    expect(locale.value).toBe('fr')
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
          appDataStore={appDataStore}
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
          appDataStore={appDataStore}
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
      store.mutateCurrentDesign((design) => ({ ...design, description: 'Browser edit' }))
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
  if (id.startsWith('file.') || id === 'drafts.open') return 'file'
  if (id.startsWith('settings.')) return 'settings'
  return null
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
