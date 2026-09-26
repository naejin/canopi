import { describe, expect, it, vi } from 'vitest'
import { createCanvasCommandProjection, type CanvasCommandProjection } from '../app/canvas-commands'
import { flattenMenuActions } from '../app/shell-commands/menus'
import type { ShellCommandState } from '../app/shell-commands'
import {
  createBrowserShellCapabilities,
  createBrowserShellCatalog,
  createBrowserShellCommandProjection,
  type BrowserShellCapabilities,
} from '../web/browser-shell-commands'

function canvasProjection(): CanvasCommandProjection {
  return createCanvasCommandProjection({
    state: {
      activeTool: 'select',
      canvasAvailable: false,
      toolSelectionAvailable: false,
      spatialEditingAvailable: true,
      hasSelection: false,
      sameSpeciesSelectionAvailable: false,
      canUndo: false,
      canRedo: false,
      settingsAvailable: false,
      gridVisible: false,
      snapToGridEnabled: true,
      rulersVisible: false,
    },
    intents: {
      selectTool: vi.fn(), undo: vi.fn(), redo: vi.fn(), toggleGrid: vi.fn(), toggleSnapToGrid: vi.fn(),
      toggleRulers: vi.fn(), edit: vi.fn(), view: vi.fn(),
    },
    translate: (key) => key,
  })
}

function capabilities(overrides: Partial<BrowserShellCapabilities> = {}): BrowserShellCapabilities {
  return {
    newDesign: () => undefined,
    openCanopi: () => undefined,
    downloadCanopi: () => undefined,
    revertDesign: () => undefined,
    importGeoJson: () => undefined,
    exportGeoJson: () => undefined,
    navigate: () => undefined,
    ...overrides,
  }
}

function project(
  caps: BrowserShellCapabilities,
  state: Partial<ShellCommandState> = {},
  canvasReady = true,
) {
  return createBrowserShellCommandProjection({
    catalog: createBrowserShellCatalog(caps, { templatesEnabled: false, canvasReady: () => canvasReady }),
    state: { hasDesign: true, revertAvailable: false, activePanel: 'canvas', sidePanel: null, ...state },
    canvas: canvasProjection(),
  })
}

describe('Web Edition shell projection', () => {
  it('builds the same five menus as Desktop from browser-safe commands', () => {
    const projection = project(capabilities(), { hasDesign: false }, false)

    expect(projection.workspaceMenus.map((menu) => menu.id)).toEqual(['file', 'edit', 'view', 'tools', 'help'])
    const file = projection.workspaceMenus[0]!
    expect(flattenMenuActions([file]).map((item) => item.id)).toEqual([
      'file.new',
      'file.openCanopi',
      'file.rename',
      'file.downloadCanopi',
      'file.revert',
      'file.importGeoJson',
      'file.exportCanvasPdf',
      'file.exportGeoJson',
      'app.settings',
    ])
    expect(flattenMenuActions(projection.workspaceMenus).map((item) => item.id)).not.toContain('file.exit')
    const disabled = new Map(flattenMenuActions([file]).map((item) => [item.id, item.disabled]))
    expect(disabled.get('file.downloadCanopi')).toBe(true)
    expect(disabled.get('file.revert')).toBe(true)
    expect(disabled.get('file.importGeoJson')).toBe(true)
    expect(disabled.get('file.exportGeoJson')).toBe(true)
    expect(projection.panelBar.primary.map((command) => command.id)).toEqual(['nav.canvas'])
    expect(projection.panelBar.design.map((command) => command.id)).toEqual([
      'nav.layers', 'nav.data', 'nav.speciesKey', 'nav.plantDb', 'nav.favorites',
    ])
    expect(projection.panelBar.planning.map((command) => command.id)).toEqual([
      'nav.calendar', 'nav.budget', 'nav.consortium',
    ])
  })

  it('does not show shortcuts a browser keeps for itself', () => {
    const projection = project(capabilities())
    expect(projection.commands.get('file.new')?.shortcut).toBeUndefined()
    expect(projection.commands.get('nav.layers')?.shortcut).toBeUndefined()
    expect(projection.commands.get('file.openCanopi')?.shortcut).toBe('Ctrl O')
    expect(projection.commands.get('help.shortcuts')?.shortcut).toBe('F1')
  })

  it('enables Revert only after the open Design changed and routes it to the controller', () => {
    const revertDesign = vi.fn(async () => true)
    const caps = createBrowserShellCapabilities({
      newDesign: vi.fn(async () => undefined),
      openCanopi: vi.fn(async () => true),
      downloadCanopi: vi.fn(async () => undefined),
      revertDesign,
    }, vi.fn(), { importGeoJson: vi.fn(), exportGeoJson: vi.fn() })

    expect(project(caps, { revertAvailable: false }).commands.get('file.revert')?.disabled).toBe(true)
    const changed = project(caps, { revertAvailable: true }).commands.get('file.revert')
    expect(changed?.disabled).toBe(false)
    changed?.action()
    expect(revertDesign).toHaveBeenCalledOnce()
  })

  it('routes GeoJSON commands to the shared GeoJSON workflow', () => {
    const geoJson = {
      importGeoJson: vi.fn(async () => ({ status: 'cancelled' as const })),
      exportGeoJson: vi.fn(async () => ({ status: 'cancelled' as const })),
    }
    const caps = createBrowserShellCapabilities({
      newDesign: vi.fn(async () => undefined),
      openCanopi: vi.fn(async () => true),
      downloadCanopi: vi.fn(async () => undefined),
      revertDesign: vi.fn(async () => true),
    }, vi.fn(), geoJson)
    const projection = project(caps)

    projection.commands.get('file.importGeoJson')?.action()
    projection.commands.get('file.exportGeoJson')?.action()

    expect(geoJson.importGeoJson).toHaveBeenCalledOnce()
    expect(geoJson.exportGeoJson).toHaveBeenCalledOnce()
  })

  it('contains rejected browser Design commands through the capability error sink', async () => {
    const failure = new Error('browser open failed')
    const onError = vi.fn()
    const caps = createBrowserShellCapabilities({
      newDesign: vi.fn(async () => undefined),
      openCanopi: vi.fn(async () => { throw failure }),
      downloadCanopi: vi.fn(async () => undefined),
      revertDesign: vi.fn(async () => true),
    }, onError, { importGeoJson: vi.fn(), exportGeoJson: vi.fn() })

    caps.openCanopi()
    await Promise.resolve()

    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(failure)
  })
})
