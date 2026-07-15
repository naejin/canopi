// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigEnv, Plugin, PluginOption, UserConfig } from 'vite'

import viteConfig from '../../vite.config'
import { parseCssDeclarations } from './support/architecture/css-facts'

describe('Web Edition build configuration', () => {
  it('selects browser and desktop adapters at build time', async () => {
    const web = await resolveConfig('web')
    const desktop = await resolveConfig('desktop')

    expect(aliasPath(web, '#platform')).toMatch(/\/src\/platform\/browser\.ts$/)
    expect(aliasPath(desktop, '#platform')).toMatch(/\/src\/platform\/desktop\.ts$/)
    expect(aliasPath(web, '#species-catalog-live')).toMatch(/\/live\.browser\.ts$/)
    expect(aliasPath(desktop, '#species-catalog-live')).toMatch(/\/live\.desktop\.ts$/)
    expect(aliasPath(web, '#design-template-import-workflow')).toMatch(/\/workflow\.browser\.ts$/)
    expect(aliasPath(desktop, '#design-template-import-workflow')).toMatch(/\/workflow\.desktop\.ts$/)
    expect(aliasPath(web, '#design-template-catalog')).toMatch(/\/catalog\.browser\.ts$/)
    expect(aliasPath(desktop, '#design-template-catalog')).toMatch(/\/catalog\.desktop\.ts$/)

    for (const config of [web, desktop]) {
      for (const alias of [
        '#platform',
        '#species-catalog-live',
        '#design-template-import-workflow',
        '#design-template-catalog',
      ]) {
        expect(existsSync(aliasPath(config, alias)), `${alias} resolves to an existing source`).toBe(true)
      }
    }
  })

  it('builds the browser entry into its isolated artifact', async () => {
    const web = await resolveConfig('web')
    const desktop = await resolveConfig('desktop')
    const webHtml = readFileSync(new URL('../../web.html', import.meta.url), 'utf8')

    expect(web.base).toBe('/app/')
    expect(web.build?.outDir).toBe('dist-web')
    expect(web.build?.rollupOptions?.input).toBe('web.html')
    expect(web.plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'canopi-web-edition-dev-entry' }),
    ]))
    expect(desktop.build?.outDir).toBe('dist')
    expect(desktop.build?.rollupOptions?.input).toBe('index.html')
    expect(webHtml).toContain('/src/main.web.tsx')
  })

  it('installs the Web development rewrite and leaves Desktop requests alone', async () => {
    const webMiddleware = installDevEntryMiddleware(await resolveConfig('web'))
    const desktopMiddleware = installDevEntryMiddleware(await resolveConfig('desktop'))
    const request = { url: '/app/index.html?from=test' }
    const next = vi.fn()

    expect(webMiddleware).toBeTypeOf('function')
    webMiddleware?.(request, {}, next)
    expect(request.url).toBe('/app/web.html?from=test')
    expect(next).toHaveBeenCalledOnce()
    expect(desktopMiddleware).toBeUndefined()
  })

  it('runs the artifact boundary scanner after every Web build', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> }
    const scannerUrl = new URL('../../scripts/check-web-build-boundaries.mjs', import.meta.url)
    const scanner = readFileSync(scannerUrl, 'utf8')

    expect(existsSync(scannerUrl)).toBe(true)
    expect(packageJson.scripts?.['build:web']).toContain(
      'vite build --mode web && node scripts/check-web-build-boundaries.mjs',
    )
    expect(scanner).toContain('MAX_CLOUDFLARE_PAGES_ASSET_BYTES')
    expect(scanner).toContain('FORBIDDEN_DUCKDB_WASM_PATTERN')
    expect(scanner).toContain('dist-web')
    expect(scanner).toContain('statSync')
    expect(scanner).toContain('@tauri-apps')
    expect(scanner).toContain('__TAURI__')
    expect(scanner).toContain('__TAURI_INTERNALS__')
    expect(scanner).toContain('app/shell/bootstrap')
    expect(scanner).toContain('ipc/design')
  })

  it('keeps the browser shell and optional sidebar inside the workspace', () => {
    const webAppCss = readFileSync(new URL('../web/WebApp.module.css', import.meta.url), 'utf8')
    const shellCss = readFileSync(
      new URL('../web/BrowserAppShell.module.css', import.meta.url),
      'utf8',
    )

    expect(cssValue(webAppCss, '.root', 'height')).toBe('100%')
    expect(cssValue(webAppCss, '.workspaceWithSidebar', 'grid-template-columns'))
      .toBe('minmax(0, 1fr)')
    expect(cssValue(webAppCss, '.workspaceWithSidebarOpen', 'grid-template-columns'))
      .toContain('minmax(320px, 380px)')
    expect(cssValue(webAppCss, '.workspaceMain', 'display')).toBe('flex')
    expect(cssValue(shellCss, '.shell', 'height')).toBe('100%')
    expect(cssValue(shellCss, '.workspaceShell', 'overflow')).toBe('hidden')
    expect(cssValue(shellCss, '.workspace', 'display')).toBe('flex')
  })
})

async function resolveConfig(mode: string): Promise<UserConfig> {
  if (typeof viteConfig !== 'function') return viteConfig
  const environment: ConfigEnv = {
    command: 'serve',
    mode,
    isSsrBuild: false,
    isPreview: false,
  }
  return Promise.resolve(viteConfig(environment))
}

function aliasPath(config: UserConfig, alias: string): string {
  const aliases = config.resolve?.alias
  if (!aliases || Array.isArray(aliases)) throw new Error('Expected object-form Vite aliases')
  const path = Object.entries(aliases).find(([name]) => name === alias)?.[1]
  if (typeof path !== 'string') throw new Error(`Missing Vite alias ${alias}`)
  return path.replace(/\\/g, '/')
}

type DevMiddleware = (
  request: { url?: string },
  response: unknown,
  next: () => void,
) => void

function installDevEntryMiddleware(config: UserConfig): DevMiddleware | undefined {
  const plugin = flattenPlugins(config.plugins ?? []).find(
    (candidate) => candidate.name === 'canopi-web-edition-dev-entry',
  )
  if (!plugin || typeof plugin.configureServer !== 'function') {
    throw new Error('Missing Web Edition development-entry plugin hook')
  }

  let middleware: DevMiddleware | undefined
  plugin.configureServer({
    middlewares: {
      use(candidate: DevMiddleware) {
        middleware = candidate
      },
    },
  } as never)
  return middleware
}

function flattenPlugins(options: readonly PluginOption[]): Plugin[] {
  return options.flatMap((option): Plugin[] => {
    if (!option) return []
    if (Array.isArray(option)) return flattenPlugins(option)
    if (typeof (option as PromiseLike<unknown>).then === 'function') {
      throw new Error('Unexpected async Vite plugin in raw test configuration')
    }
    return [option as Plugin]
  })
}

function cssValue(source: string, rule: string, property: string): string | undefined {
  return parseCssDeclarations('fixture.module.css', source).find(
    (declaration) => declaration.rule === rule && declaration.property === property,
  )?.value
}
