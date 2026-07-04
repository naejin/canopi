import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activePanel, sidePanel } from '../app/shell/state'
import { locale, theme } from '../app/settings/state'
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
      render(<WebApp />, container)
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

    await act(async () => {
      render(<BrowserAppShell handlers={handlers} />, container)
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
    expect(theme.value).toBe('dark')
    expect(locale.value).toBe('fr')
    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBeNull()
  })
})

function clickCommand(container: HTMLElement, id: string): void {
  const button = container.querySelector<HTMLButtonElement>(`[data-web-command-id="${id}"]`)
  if (!button) throw new Error(`Missing command ${id}`)
  button.click()
}
