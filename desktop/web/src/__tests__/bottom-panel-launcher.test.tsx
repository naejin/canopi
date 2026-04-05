import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BottomPanelLauncher } from '../components/canvas/BottomPanelLauncher'
import { locale } from '../state/app'
import { bottomPanelOpen, bottomPanelTab } from '../state/canvas'

describe('BottomPanelLauncher', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    bottomPanelOpen.value = false
    bottomPanelTab.value = 'timeline'
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
})
