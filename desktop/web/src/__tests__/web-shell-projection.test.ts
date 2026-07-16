import { describe, expect, it, vi } from 'vitest'
import {
  createBrowserShellCapabilities,
  createBrowserShellCommandProjection,
} from '../web/browser-shell-commands'

describe('Web Edition shell projection', () => {
  it('groups only browser-safe commands for menu and right-rail chrome', () => {
    const projection = createBrowserShellCommandProjection({
      currentPanel: 'canvas',
      currentSidePanel: null,
      downloadCanopiEnabled: false,
      templatesEnabled: false,
      capabilities: {
        newDesign: () => undefined,
        openCanopi: () => undefined,
        downloadCanopi: () => undefined,
        navigate: () => undefined,
        toggleTheme: () => undefined,
      },
    })

    expect(projection.menus.map((menu) => ({
      id: menu.id,
      commandIds: menu.items.map((item) => item.id),
    }))).toEqual([
      {
        id: 'file',
        commandIds: ['file.new', 'file.openCanopi', 'file.downloadCanopi'],
      },
    ])
    expect(projection.panelBar.primary.map((command) => command.id)).toEqual([
      'nav.canvas',
    ])
    expect(projection.panelBar.side.map((command) => command.id)).toEqual([
      'nav.plantDb',
      'nav.favorites',
    ])

    expect(projection.menus[0]?.items.find((item) => item.id === 'file.downloadCanopi')?.disabled).toBe(true)
  })

  it('contains rejected browser Design commands through the capability error sink', async () => {
    const failure = new Error('browser open failed')
    const onError = vi.fn()
    const capabilities = createBrowserShellCapabilities({
      newDesign: vi.fn(async () => undefined),
      openCanopi: vi.fn(async () => { throw failure }),
      downloadCanopi: vi.fn(async () => undefined),
    }, onError)

    capabilities.openCanopi()
    await Promise.resolve()

    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(failure)
  })
})
