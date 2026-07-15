import { describe, expect, it } from 'vitest'
import { createBrowserShellProjection } from '../web/browser-shell-projection'

describe('Web Edition shell projection', () => {
  it('groups only browser-safe commands for menu and right-rail chrome', () => {
    const projection = createBrowserShellProjection({
      currentPanel: 'canvas',
      currentSidePanel: null,
      downloadCanopiEnabled: false,
      templatesEnabled: false,
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
})
