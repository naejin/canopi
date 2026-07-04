import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activePanel, sidePanel } from '../app/shell/state'
import { locale, theme } from '../app/settings/state'
import { createBrowserAppDataStore, type BrowserStorageAdapter } from '../web/browser-app-data'
import { BrowserAppShell, type BrowserShellCommandHandlers } from '../web/BrowserAppShell'
import { WebApp } from '../web/WebApp'

function commandIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-web-command-id]'))
    .map((element) => element.dataset.webCommandId ?? '')
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
    expect(commandIds(container)).toEqual([
      'file.new',
      'file.openCanopi',
      'file.downloadCanopi',
      'drafts.open',
      'settings.language',
      'settings.theme',
      'nav.canvas',
      'nav.location',
      'nav.plantDb',
      'nav.favorites',
    ])
    expect(container.textContent).toContain('Open .canopi')
    expect(container.textContent).toContain('Download .canopi')
    expect(container.textContent).toContain('Drafts')
    expect(container.textContent).not.toContain('Design Notebook')
    expect(container.textContent).not.toContain('Problem Report')
    expect(container.textContent).not.toContain('Save As')
    expect(container.textContent).not.toContain('Exit')
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

    await act(async () => {
      clickCommand(container, 'file.new')
      clickCommand(container, 'file.openCanopi')
      clickCommand(container, 'file.downloadCanopi')
      clickCommand(container, 'drafts.open')
      clickCommand(container, 'settings.theme')
      clickCommand(container, 'settings.language')
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

    await act(async () => {
      clickCommand(container, 'drafts.open')
    })

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
    await act(async () => {
      clickCommand(container, 'settings.theme')
      clickCommand(container, 'settings.language')
    })

    render(null, container)
    theme.value = 'light'
    locale.value = 'en'

    await act(async () => {
      render(<WebApp appDataStore={appDataStore} workspace={<div data-testid="stub-workspace" />} />, container)
    })

    expect(theme.value).toBe('dark')
    expect(locale.value).toBe('fr')
  })
})

function clickCommand(container: HTMLElement, id: string): void {
  const button = container.querySelector<HTMLButtonElement>(`[data-web-command-id="${id}"]`)
  if (!button) throw new Error(`Missing command ${id}`)
  button.click()
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
