import { describe, expect, it } from 'vitest'
import { createBrowserShellProjection } from '../web/browser-shell-projection'

describe('Web Edition shell projection', () => {
  it('groups only browser-safe commands for menu and right-rail chrome', () => {
    const projection = createBrowserShellProjection({
      currentLocale: 'en',
      currentTheme: 'light',
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
        commandIds: ['file.new', 'file.openCanopi', 'file.downloadCanopi', 'drafts.open'],
      },
      {
        id: 'settings',
        commandIds: ['settings.language', 'settings.theme'],
      },
    ])
    expect(projection.panelBar.primary.map((command) => command.id)).toEqual([
      'nav.canvas',
      'nav.location',
    ])
    expect(projection.panelBar.side.map((command) => command.id)).toEqual([
      'nav.plantDb',
      'nav.favorites',
    ])

    const projectedIds = [
      ...projection.menus.flatMap((menu) => menu.items.map((item) => item.id)),
      ...projection.panelBar.primary.map((command) => command.id),
      ...projection.panelBar.side.map((command) => command.id),
    ]
    expect(projectedIds).not.toContain('file.save')
    expect(projectedIds).not.toContain('file.saveAs')
    expect(projectedIds).not.toContain('file.openRecent')
    expect(projectedIds).not.toContain('file.revealInFileManager')
    expect(projectedIds).not.toContain('file.exportDesignReportPdf')
    expect(projectedIds).not.toContain('nav.designNotebook')
    expect(projectedIds).not.toContain('nav.timeline')
    expect(projectedIds).not.toContain('nav.budget')
    expect(projectedIds).not.toContain('nav.consortium')
    expect(projectedIds).not.toContain('nav.siteAdaptation')
    expect(projectedIds).not.toContain('view.displayBy')
    expect(projectedIds).not.toContain('view.colorBy')
    expect(projectedIds).not.toContain('help.reportProblem')
    expect(projectedIds).not.toContain('help.checkForUpdates')
    expect(projectedIds).not.toContain('location.geocode')
    expect(projection.menus[0]?.items.find((item) => item.id === 'file.downloadCanopi')?.disabled).toBe(true)
  })
})
