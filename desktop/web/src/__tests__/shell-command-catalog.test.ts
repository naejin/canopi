import { describe, expect, it, vi } from 'vitest'
import {
  composeShellCommandCatalog,
  matchShellCommandShortcut,
  projectShellCommandCatalog,
} from '../app/shell-commands'

describe('App Command Graph shell catalog', () => {
  it('includes only the command identities supported by supplied platform capabilities', () => {
    const execute = () => undefined

    const catalog = composeShellCommandCatalog({
      newDesign: { execute },
      openCanopi: { execute },
      downloadCanopi: { execute },
      navigateCanvas: { execute },
      navigateTemplates: { execute },
      navigatePlantDatabase: { execute },
      navigateFavorites: { execute },
      toggleTheme: { execute },
    })

    expect(catalog.map((command) => command.id)).toEqual([
      'file.new',
      'file.openCanopi',
      'file.downloadCanopi',
      'nav.canvas',
      'nav.templates',
      'nav.plantDb',
      'nav.favorites',
      'view.toggleTheme',
    ])
  })

  it('composes the desktop command identities without browser file capabilities', () => {
    const execute = () => undefined

    const catalog = composeShellCommandCatalog({
      newDesign: { execute },
      openDesign: { execute },
      saveDesign: { execute },
      saveDesignAs: { execute },
      exitApp: { execute },
      navigateCanvas: { execute },
      navigateLocation: { execute },
      navigatePlantDatabase: { execute },
      navigateFavorites: { execute },
      navigateDesignNotebook: { execute },
      toggleTheme: { execute },
    })

    expect(catalog.map((command) => command.id)).toEqual([
      'file.new',
      'file.open',
      'file.save',
      'file.saveAs',
      'file.exit',
      'nav.canvas',
      'nav.location',
      'nav.plantDb',
      'nav.favorites',
      'nav.designNotebook',
      'view.toggleTheme',
    ])
  })

  it('matches composed shell shortcuts to their command identities', () => {
    const execute = () => undefined
    const catalog = composeShellCommandCatalog({
      newDesign: { execute },
      saveDesign: { execute },
      saveDesignAs: { execute },
      navigateCanvas: { execute },
      navigatePlantDatabase: { execute },
    })
    const match = (
      key: string,
      modifiers: Partial<{
        ctrlKey: boolean
        metaKey: boolean
        shiftKey: boolean
        altKey: boolean
      }> = {},
    ) => matchShellCommandShortcut(catalog, {
      key,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...modifiers,
    })?.id ?? null

    expect(match('n', { ctrlKey: true })).toBe('file.new')
    expect(match('S', { metaKey: true, shiftKey: true })).toBe('file.saveAs')
    expect(match('2', { ctrlKey: true })).toBe('nav.plantDb')
    expect(match('2', { ctrlKey: true, altKey: true })).toBeNull()
    expect(match('n', { ctrlKey: true, metaKey: true })).toBeNull()
    expect(match('n')).toBeNull()
  })

  it('projects caller-ready browser menu and panel commands', () => {
    const newDesign = vi.fn()
    const downloadCanopi = vi.fn()
    const navigateFavorites = vi.fn()
    const catalog = composeShellCommandCatalog({
      newDesign: { execute: newDesign },
      openCanopi: { execute: () => undefined },
      downloadCanopi: {
        execute: downloadCanopi,
        isProjectionDisabled: (state) => !state.hasDesign,
      },
      navigateCanvas: { execute: () => undefined },
      navigatePlantDatabase: { execute: () => undefined },
      navigateFavorites: { execute: navigateFavorites },
      toggleTheme: { execute: () => undefined },
    })

    const projection = projectShellCommandCatalog(catalog, {
      hasDesign: false,
      designDirty: false,
      activePanel: 'canvas',
      sidePanel: 'favorites',
    }, (key) => `translated:${key}`)

    expect(projection.menus.map((menu) => ({
      id: menu.id,
      commandIds: menu.items.map((command) => command.id),
    }))).toEqual([{
      id: 'file',
      commandIds: ['file.new', 'file.openCanopi', 'file.downloadCanopi'],
    }])
    expect(projection.menus[0]?.sections.map((section) =>
      section.map((command) => command.id)
    )).toEqual([
      ['file.new', 'file.openCanopi'],
      ['file.downloadCanopi'],
    ])
    expect(projection.panelBar.primary.map((command) => command.id)).toEqual(['nav.canvas'])
    expect(projection.panelBar.side.map((command) => command.id)).toEqual([
      'nav.plantDb',
      'nav.favorites',
    ])
    expect(projection.commands.get('file.downloadCanopi')).toMatchObject({ disabled: true })
    expect(projection.commands.get('nav.favorites')).toMatchObject({
      label: 'translated:nav.favorites',
      active: true,
      disabled: false,
    })
    expect(projection.commands.get('nav.canvas')).toMatchObject({ active: false })

    projection.commands.get('file.new')?.action()
    projection.commands.get('file.downloadCanopi')?.action()
    projection.commands.get('nav.favorites')?.action()

    expect(newDesign).toHaveBeenCalledOnce()
    expect(downloadCanopi).not.toHaveBeenCalled()
    expect(navigateFavorites).toHaveBeenCalledOnce()
  })
})
