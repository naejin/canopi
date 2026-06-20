import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aboutCanopiDialogOpen, closeAboutCanopiDialog } from '../app/about/state'
import { CANOPI_LICENSE, CANOPI_VERSION } from '../app/about/metadata'
import { locale } from '../app/settings/state'
import { runAppCommand } from '../commands/registry'
import { AboutCanopiDialog } from '../components/shared/AboutCanopiDialog'

describe('AboutCanopiDialog', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    closeAboutCanopiDialog()
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    closeAboutCanopiDialog()
  })

  it('opens from the Help command and shows standard app information', async () => {
    runAppCommand('help.aboutCanopi')

    await act(async () => {
      render(<AboutCanopiDialog />, container)
      await Promise.resolve()
    })

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog?.textContent).toContain('About Canopi')
    expect(dialog?.textContent).toContain(`Version ${CANOPI_VERSION}`)
    expect(dialog?.textContent).toContain(CANOPI_LICENSE)
    expect(container.querySelector('img')).toBeTruthy()

    const closeButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Close')
    expect(closeButton).toBeTruthy()

    await act(async () => {
      closeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(aboutCanopiDialogOpen.value).toBe(false)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
