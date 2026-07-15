import * as fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const { readFileSync, readdirSync } = fs

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function importSpecifiers(source: string): string[] {
  return Array.from(
    source.matchAll(/(?:\bfrom\s+|^\s*import\s+|\bimport\s*\(\s*)['"]([^'"]+)['"]/gm),
    (match) => match[1] ?? '',
  )
}

const FORBIDDEN_IMPORTS = [
  /@tauri-apps/,
  /(?:^|\/)web(?:\/|$)/,
  /(?:^|\/)platform(?:[/.]|$)/,
  /(?:^|\/)ipc(?:[/.]|$)/,
  /browser-(?:app-data|partition-storage|design-session)/,
  /(?:^|[/.-])storage(?:[/.-]|$)/,
  /(?:^|\/)app\/shell(?:[/.]|$)/,
  /(?:^|\/)commands\/graph(?:[/.]|$)/,
]

function isForbiddenImport(specifier: string): boolean {
  return FORBIDDEN_IMPORTS.some((forbidden) => forbidden.test(specifier))
}

describe('Canvas Command Projection boundaries', () => {
  it('recognizes static and dynamic import edges in the boundary guard', () => {
    expect(importSpecifiers(`
      import type { Canvas } from './canvas'
      const platform = import('../platform/canvas.desktop')
    `)).toEqual([
      './canvas',
      '../platform/canvas.desktop',
    ])
  })

  it('recognizes generic storage paths without rejecting neutral neighbors', () => {
    expect(isForbiddenImport('../app/storage/index')).toBe(true)
    expect(isForbiddenImport('../adapters/browser-partition-storage')).toBe(true)
    expect(isForbiddenImport('../foo-storage')).toBe(true)
    expect(isForbiddenImport('../app/canvas-commands')).toBe(false)
  })

  it('keeps the neutral projection free of platform and shell imports', () => {
    const directory = 'src/app/canvas-commands'
    const sources = readdirSync(directory)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => ({
        name,
        source: readFileSync(`${directory}/${name}`, 'utf8'),
      }))
    for (const { name, source } of sources) {
      for (const specifier of importSpecifiers(source)) {
        expect(isForbiddenImport(specifier), `${name} imports ${specifier}`).toBe(false)
      }
    }
  })

  it('keeps Canvas toolbar identity and shortcuts in the neutral catalog', () => {
    const shortcutDefinitions = readSource('../shortcuts/definitions.ts')
    const shortcutAdapter = readSource('../commands/graph/shortcuts.ts')
    const commandCatalog = readSource('../commands/graph/catalog.ts')
    const desktopProjection = readSource('../commands/graph/projections.ts')
    const webToolbar = readSource('../web/WebCanvasToolbar.tsx')

    expect(shortcutDefinitions).toContain("from '../app/canvas-commands'")
    expect(shortcutDefinitions).not.toContain('export const EDIT_SHORTCUTS = {')
    expect(shortcutDefinitions).not.toContain('export const TOOL_SHORTCUTS = {')
    expect(shortcutDefinitions).not.toContain('export const canvasToolKeys:')
    expect(shortcutAdapter).toContain('canvasToolCommandIdForShortcut')
    expect(shortcutAdapter).toContain('canvasHistoryCommandIdForShortcut')
    expect(shortcutAdapter).not.toContain('TOOL_COMMAND_IDS')
    expect(commandCatalog).toContain('canvasCommandDefinitions')
    expect(commandCatalog).toContain('createCanvasCommandProjection')
    expect(desktopProjection).not.toContain('TOOLBAR_PRIMARY_TOOLS')
    expect(desktopProjection).not.toContain('TOOLBAR_CREATION_TOOLS')
    expect(webToolbar).toContain('createCanvasCommandProjection')
    expect(webToolbar).not.toContain('WEB_TOOLS')
  })
})
