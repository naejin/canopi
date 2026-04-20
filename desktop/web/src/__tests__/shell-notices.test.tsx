import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    close: vi.fn(),
    minimize: vi.fn(),
    startDragging: vi.fn(),
    toggleMaximize: vi.fn(),
  }),
}))

vi.mock('../app/updater/config', () => ({
  UPDATE_CHANNELS: ['stable', 'beta'],
  updaterControlsVisible: true,
  updaterEnabled: true,
}))

vi.mock('../app/updater/controller', () => ({
  dismissUpdate: vi.fn(),
  getUpdaterBlockedReason: vi.fn(() => null),
  installAvailableUpdate: vi.fn(),
  restartToApplyUpdate: vi.fn(),
  retryUpdateAction: vi.fn(),
}))

import { TitleBar } from '../components/shared/TitleBar'
import { ShellNotices } from '../components/shared/ShellNotices'
import { activePanel } from '../app/shell/state'
import { plantDbStatus } from '../app/health/state'
import { updaterState } from '../app/updater/state'
import { designName, currentDesign, resetDirtyBaselines } from '../state/design'
import { settingsModalOpen } from '../app/settings/modal-state'
import { locale, theme, updateChannel } from '../app/settings/state'

describe('shell notices', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    theme.value = 'light'
    updateChannel.value = 'stable'
    settingsModalOpen.value = false
    activePanel.value = 'canvas'
    designName.value = 'Demo Design'
    currentDesign.value = {
      version: 2,
      name: 'Demo Design',
      description: null,
      location: null,
      north_bearing_deg: null,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '',
      updated_at: '',
      extra: {},
    }
    resetDirtyBaselines()
    plantDbStatus.value = 'available'
    updaterState.value = { status: 'idle' }
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('does not render updater status inside the title bar', async () => {
    updaterState.value = {
      status: 'available',
      channel: 'stable',
      version: '0.5.0',
      body: null,
      date: null,
    }

    await act(async () => {
      render(<TitleBar />, container)
    })

    expect(container.textContent).toContain('Demo Design')
    expect(container.textContent).not.toContain('Canopi 0.5.0 is available')
  })

  it('disables title-bar quick controls while the settings modal is open', async () => {
    settingsModalOpen.value = true

    await act(async () => {
      render(<TitleBar />, container)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    const languageTrigger = buttons.find((button) => button.textContent?.includes('EN'))
    const themeButton = buttons.find((button) => button.getAttribute('aria-label') === 'Theme')

    expect(languageTrigger?.disabled).toBe(true)
    expect(themeButton?.disabled).toBe(true)
  })

  it('renders degraded health before updater availability in the shell notice stack', async () => {
    plantDbStatus.value = 'missing'
    updaterState.value = {
      status: 'available',
      channel: 'stable',
      version: '0.5.0',
      body: null,
      date: null,
    }

    await act(async () => {
      render(<ShellNotices />, container)
    })

    const notices = Array.from(container.querySelectorAll('[data-shell-notice]'))
    expect(notices).toHaveLength(2)
    expect(notices[0]?.getAttribute('data-shell-notice')).toBe('health')
    expect(notices[1]?.getAttribute('data-shell-notice')).toBe('updater')
    expect(notices[0]?.textContent).toContain('Plant database not found')
    expect(notices[1]?.textContent).toContain('Canopi 0.5.0 is available')
  })
})
