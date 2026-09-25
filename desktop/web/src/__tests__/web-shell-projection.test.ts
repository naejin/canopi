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
      revertAvailable: false,
      geoJsonEnabled: false,
      templatesEnabled: false,
      capabilities: {
        newDesign: () => undefined,
        openCanopi: () => undefined,
        downloadCanopi: () => undefined,
        revertDesign: () => undefined,
        importGeoJson: () => undefined,
        exportGeoJson: () => undefined,
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
        commandIds: [
          'file.new',
          'file.openCanopi',
          'file.revert',
          'file.downloadCanopi',
          'file.exportCanvasPdf',
          'file.importGeoJson',
          'file.exportGeoJson',
        ],
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
    expect(projection.menus[0]?.items.find((item) => item.id === 'file.revert')?.disabled).toBe(true)
    expect(projection.menus[0]?.items.find((item) => item.id === 'file.importGeoJson')?.disabled).toBe(true)
    expect(projection.menus[0]?.items.find((item) => item.id === 'file.exportGeoJson')?.disabled).toBe(true)
  })

  it('enables Revert only after the open Design changed and routes it to the controller', () => {
    const revertDesign = vi.fn(async () => true)
    const capabilities = createBrowserShellCapabilities({
      newDesign: vi.fn(async () => undefined),
      openCanopi: vi.fn(async () => true),
      downloadCanopi: vi.fn(async () => undefined),
      revertDesign,
    }, vi.fn(), { importGeoJson: vi.fn(), exportGeoJson: vi.fn() })
    const project = (revertAvailable: boolean) => createBrowserShellCommandProjection({
      currentPanel: 'canvas',
      currentSidePanel: null,
      downloadCanopiEnabled: true,
      revertAvailable,
      geoJsonEnabled: true,
      templatesEnabled: false,
      capabilities: { ...capabilities, navigate: () => undefined, toggleTheme: () => undefined },
    })

    expect(project(false).commands.get('file.revert')?.disabled).toBe(true)
    const changed = project(true).commands.get('file.revert')
    expect(changed?.disabled).toBe(false)
    changed?.action()
    expect(revertDesign).toHaveBeenCalledOnce()
  })

  it('routes GeoJSON commands to the shared GeoJSON workflow', async () => {
    const geoJson = {
      importGeoJson: vi.fn(async () => ({ status: 'cancelled' as const })),
      exportGeoJson: vi.fn(async () => ({ status: 'cancelled' as const })),
    }
    const capabilities = createBrowserShellCapabilities({
      newDesign: vi.fn(async () => undefined),
      openCanopi: vi.fn(async () => true),
      downloadCanopi: vi.fn(async () => undefined),
      revertDesign: vi.fn(async () => true),
    }, vi.fn(), geoJson)
    const projection = createBrowserShellCommandProjection({
      currentPanel: 'canvas',
      currentSidePanel: null,
      downloadCanopiEnabled: true,
      revertAvailable: false,
      geoJsonEnabled: true,
      templatesEnabled: false,
      capabilities: { ...capabilities, navigate: () => undefined, toggleTheme: () => undefined },
    })

    projection.commands.get('file.importGeoJson')?.action()
    projection.commands.get('file.exportGeoJson')?.action()

    expect(geoJson.importGeoJson).toHaveBeenCalledOnce()
    expect(geoJson.exportGeoJson).toHaveBeenCalledOnce()
  })

  it('contains rejected browser Design commands through the capability error sink', async () => {
    const failure = new Error('browser open failed')
    const onError = vi.fn()
    const capabilities = createBrowserShellCapabilities({
      newDesign: vi.fn(async () => undefined),
      openCanopi: vi.fn(async () => { throw failure }),
      downloadCanopi: vi.fn(async () => undefined),
      revertDesign: vi.fn(async () => true),
    }, onError, { importGeoJson: vi.fn(), exportGeoJson: vi.fn() })

    capabilities.openCanopi()
    await Promise.resolve()

    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(failure)
  })
})
