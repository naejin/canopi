import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BottomPanelLauncher } from '../components/canvas/BottomPanelLauncher'
import { locale } from '../app/settings/state'
import { bottomPanelOpen, bottomPanelTab } from '../state/canvas'

describe('BottomPanelLauncher', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    bottomPanelOpen.value = false
    bottomPanelTab.value = 'budget'
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('renders all visible bottom-panel tabs and toggles open on click', async () => {
    await act(async () => {
      render(<BottomPanelLauncher />, container)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Timeline', 'Budget', 'Consortium'])

    await act(async () => {
      buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(bottomPanelOpen.value).toBe(true)
    expect(bottomPanelTab.value).toBe('timeline')
  })

  it('closes the active tab when it is clicked again', async () => {
    bottomPanelOpen.value = true
    bottomPanelTab.value = 'budget'

    await act(async () => {
      render(<BottomPanelLauncher />, container)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    const budgetButton = buttons.find((button) => button.textContent?.trim() === 'Budget')
    expect(budgetButton).toBeTruthy()

    await act(async () => {
      budgetButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(bottomPanelOpen.value).toBe(false)
    expect(bottomPanelTab.value).toBe('budget')
  })
})
