import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { locale } from '../app/settings/state'
import {
  closeKeyboardShortcutsDialog,
  gettingStartedDialogOpen,
  keyboardShortcutsDialogOpen,
} from '../app/shell/dialogs'
import { createWorkspaceShellCapabilities } from '../app/workspace-commands/capabilities'
import { GettingStartedDialog } from '../components/shared/GettingStartedDialog'

describe('Help › Getting started', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    locale.value = 'en'
  })

  afterEach(() => {
    gettingStartedDialogOpen.value = false
    closeKeyboardShortcutsDialog()
    render(null, container)
    container.remove()
    locale.value = 'en'
  })

  it('opens a short guide in the interface’s own words for tools and panels', async () => {
    await act(async () => { render(<GettingStartedDialog />, container) })
    expect(container.innerHTML).toBe('')

    await act(async () => { createWorkspaceShellCapabilities().gettingStarted.execute() })
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.querySelector('h2')?.textContent).toBe('Getting started')
    const steps = [...dialog.querySelectorAll('ol > li')].map((step) => step.textContent)
    expect(steps).toHaveLength(6)
    expect(steps[0]).toContain('Ctrl K')
    expect(steps[2]).toContain('Place plants')
    expect(steps[2]).toContain('Plant a row')
    expect(steps[4]).toContain('Calendar')
    expect(steps[4]).toContain('Budget')
    expect(dialog.querySelector('a[href]')).toBeNull()

    const done = [...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Done')!
    await act(async () => { done.click() })
    expect(gettingStartedDialogOpen.value).toBe(false)
  })

  it('hands over to Keyboard shortcuts, and reads in the chosen language', async () => {
    locale.value = 'fr'
    await act(async () => { render(<GettingStartedDialog />, container) })
    await act(async () => { gettingStartedDialogOpen.value = true })
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toContain('Placer des plantes')

    const shortcuts = [...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Raccourcis clavier')!
    await act(async () => { shortcuts.click() })
    expect(gettingStartedDialogOpen.value).toBe(false)
    expect(keyboardShortcutsDialogOpen.value).toBe(true)
  })
})
