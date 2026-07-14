import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import { resolveWebEditionDevHtmlUrl } from '../web/dev-entry'

const { existsSync, readFileSync } = fs
const fsWithDirectoryRead = fs as unknown as {
  readdirSync(
    path: URL,
    options: { withFileTypes: true },
  ): Array<{ name: string; isDirectory(): boolean }>
}

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function sourceExists(path: string): boolean {
  return existsSync(new URL(path, import.meta.url))
}

function sourceFilesUnder(path: string): string[] {
  const entries = fsWithDirectoryRead.readdirSync(new URL(path, import.meta.url), { withFileTypes: true })
  return entries.flatMap((entry) => {
    const child = `${path.replace(/\/$/, '')}/${entry.name}`
    if (entry.isDirectory()) return sourceFilesUnder(child)
    return child
  })
}

function isTypescriptSource(path: string): boolean {
  return /\.(ts|tsx)$/.test(path) && !/\.test\.(ts|tsx)$/.test(path)
}

function isTypescriptTestSource(path: string): boolean {
  return /\.test\.(ts|tsx)$/.test(path)
}

function importSpecifiers(source: string): string[] {
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
  ]

  return patterns.flatMap((pattern) =>
    Array.from(source.matchAll(pattern), (match) => match[1] ?? ''),
  )
}

function expectImportsToContain(
  sourcePath: string,
  expectedSpecifiers: readonly string[],
): void {
  const specifiers = importSpecifiers(readSource(sourcePath))
  for (const specifier of expectedSpecifiers) {
    expect(specifiers, `${sourcePath} imports`).toContain(specifier)
  }
}

function namedImportsFrom(sourcePath: string, moduleSpecifier: string): string[] {
  const escapedSpecifier = moduleSpecifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `\\bimport\\s*\\{([^}]*)\\}\\s*from\\s*['"]${escapedSpecifier}['"]`,
    'g',
  )
  return Array.from(readSource(sourcePath).matchAll(pattern))
    .flatMap((match) => (match[1] ?? '').split(','))
    .map((entry) => entry.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim() ?? '')
    .filter(Boolean)
}

function expectNamedImportsFrom(
  sourcePath: string,
  moduleSpecifier: string,
  expectedNames: readonly string[],
): void {
  expect(
    namedImportsFrom(sourcePath, moduleSpecifier).sort(),
    `${sourcePath} named imports from ${moduleSpecifier}`,
  ).toEqual([...expectedNames].sort())
}

function expectNoImportsMatching(
  sourcePath: string,
  forbiddenPatterns: readonly RegExp[],
): void {
  for (const specifier of importSpecifiers(readSource(sourcePath))) {
    for (const pattern of forbiddenPatterns) {
      expect(specifier, `${sourcePath} imports ${specifier}`).not.toMatch(pattern)
    }
  }
}

function cssRuleBody(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`${escapedSelector}\\s*{(?<body>[^}]*)}`))?.groups?.body ?? ''
}

describe('frontend boundary sources', () => {
  it('exposes a separate Web Edition build entry behind compile-time platform adapters', () => {
    const packageSource = readSource('../../package.json')
    const viteSource = readSource('../../vite.config.ts')
    const desktopEntrySource = readSource('../main.tsx')
    const webEntrySource = readSource('../main.web.tsx')
    const webHtmlSource = readSource('../../web.html')

    expect(sourceExists('../../web.html')).toBe(true)
    expect(sourceExists('../platform/desktop.ts')).toBe(true)
    expect(sourceExists('../platform/browser.ts')).toBe(true)
    expect(packageSource).toContain('"build:web"')
    expect(viteSource).toContain("mode === 'web'")
    expect(viteSource).toContain("'#platform'")
    expect(viteSource).toContain('platform/browser.ts')
    expect(viteSource).toContain('platform/desktop.ts')
    expect(webHtmlSource).toContain('/src/main.web.tsx')
    expect(desktopEntrySource).toContain('#platform')
    expect(webEntrySource).toContain('#platform')
    expect(webEntrySource).toContain('maplibre-gl/dist/maplibre-gl.css')
    expect(webEntrySource).not.toContain('./app/shell/bootstrap')
    expect(webEntrySource).not.toContain('./app/shell/close-guard')
    expect(webEntrySource).not.toContain('@tauri-apps')
    expect(webEntrySource).not.toContain('./app')
  })

  it('serves the Web Edition entry from the advertised dev base route', () => {
    const viteSource = readSource('../../vite.config.ts')
    const webAppCss = readSource('../web/WebApp.module.css')
    const browserShellCss = readSource('../web/BrowserAppShell.module.css')

    expect(resolveWebEditionDevHtmlUrl('/app/')).toBe('/app/web.html')
    expect(resolveWebEditionDevHtmlUrl('/app')).toBe('/app/web.html')
    expect(resolveWebEditionDevHtmlUrl('/app/index.html?from=test')).toBe('/app/web.html?from=test')
    expect(resolveWebEditionDevHtmlUrl('/app/web.html')).toBeNull()
    expect(viteSource).toContain('resolveWebEditionDevHtmlUrl')
    expect(cssRuleBody(webAppCss, '.root')).toContain('height: 100%')
    expect(cssRuleBody(webAppCss, '.workspaceWithSidebar')).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(cssRuleBody(webAppCss, '.workspaceWithSidebarOpen')).toContain('minmax(320px, 380px)')
    expect(cssRuleBody(webAppCss, '.workspaceMain')).toContain('display: flex')
    expect(cssRuleBody(browserShellCss, '.shell')).toContain('height: 100%')
    expect(cssRuleBody(browserShellCss, '.workspaceShell')).toContain('overflow: hidden')
    expect(cssRuleBody(browserShellCss, '.workspace')).toContain('display: flex')
  })

  it('runs a Web Edition build artifact boundary check after browser bundling', () => {
    const packageSource = readSource('../../package.json')
    const boundaryScriptSource = readSource('../../scripts/check-web-build-boundaries.mjs')

    expect(sourceExists('../../scripts/check-web-build-boundaries.mjs')).toBe(true)
    expect(packageSource).toContain('vite build --mode web && node scripts/check-web-build-boundaries.mjs')
    expect(boundaryScriptSource).toContain('dist-web')
    expect(boundaryScriptSource).toContain('@tauri-apps')
    expect(boundaryScriptSource).toContain('__TAURI__')
    expect(boundaryScriptSource).toContain('__TAURI_INTERNALS__')
    expect(boundaryScriptSource).toContain('app/shell/bootstrap')
    expect(boundaryScriptSource).toContain('ipc/design')
    expect(boundaryScriptSource).toContain('MAX_CLOUDFLARE_PAGES_ASSET_BYTES')
    expect(boundaryScriptSource).toContain('FORBIDDEN_DUCKDB_WASM_PATTERN')
    expect(boundaryScriptSource).toContain('statSync')
  })

  it('keeps Web Edition shell sources free of desktop-only app chrome', () => {
    const webSources = sourceFilesUnder('../web').filter(isTypescriptSource)
    const forbiddenImports = [
      /@tauri-apps/,
      /(^|\/)ipc(\/|$)/,
      /components\/shared\/TitleBar$/,
      /components\/shared\/MenuBar$/,
      /components\/shared\/ProblemReportDialog$/,
      /components\/panels\/DesignNotebookPanel$/,
      /components\/panels\/CanvasPanel$/,
      /components\/canvas\/BottomPanel$/,
      /components\/canvas\/TimelineTab$/,
      /components\/canvas\/BudgetTab$/,
      /components\/canvas\/ConsortiumChart$/,
      /components\/canvas\/DisplayLegend$/,
      /app\/design-notebook(\/|$)/,
      /app\/document-session\/actions$/,
      /app\/document-session\/lifecycle$/,
      /app\/document-session\/transition$/,
      /app\/document-session\/state-machine$/,
      /app\/problem-report(\/|$)/,
      /app\/settings\/projection$/,
      /app\/location$/,
      /app\/location\/index$/,
      /app\/location\/coordinate-workbench$/,
      /app\/location\/search-controller$/,
      /ipc\/geocoding$/,
      /commands\/registry$/,
      /commands\/graph(\/|$)/,
    ]

    for (const sourcePath of webSources) {
      const source = readSource(sourcePath)
      expectNoImportsMatching(sourcePath, forbiddenImports)
      expect(source, `${sourcePath} should not mention desktop-only chrome`).not.toContain('DesignNotebook')
      expect(source, `${sourcePath} should not mention problem reporting`).not.toContain('ProblemReport')
      expect(source, `${sourcePath} should not expose native save-as`).not.toContain('saveAs')
      expect(source, `${sourcePath} should not expose web geocoding`).not.toContain('geocode')
      expect(source, `${sourcePath} should not mount Web Location`).not.toContain('WebLocation')
    }
  })

  it('keeps Web Edition Species detail reduced and desktop-detail free', () => {
    const webPanelSource = readSource('../web/WebSpeciesCatalogPanel.tsx')

    expectNoImportsMatching('../web/WebSpeciesCatalogPanel.tsx', [
      /components\/plant-detail/,
      /app\/plant-detail/,
      /ipc\/species/,
    ])
    expect(webPanelSource).not.toContain('height')
    expect(webPanelSource).not.toContain('hardiness')
    expect(webPanelSource).not.toContain('stratum')
    expect(webPanelSource).not.toContain('uses')
    expect(webPanelSource).not.toContain('soil')
    expect(webPanelSource).not.toContain('ecology')
    expect(webPanelSource).not.toContain('propagation')
    expect(webPanelSource).not.toContain('related')
  })

  it('keeps the remaining workflow components free of direct ipc imports', () => {
    const welcomeSource = readSource('../components/shared/WelcomeScreen.tsx')
    const budgetSource = readSource('../components/canvas/BudgetTab.tsx')

    expect(welcomeSource).not.toContain('ipc/design')
    expect(budgetSource).not.toContain('ipc/design')
  })

  it('keeps retired Site Adaptation out of active frontend source', () => {
    expect(sourceExists('../app/adaptation/index.ts')).toBe(false)
    expect(sourceExists('../app/adaptation/controller.ts')).toBe(false)
    expect(sourceExists('../ipc/adaptation.ts')).toBe(false)
    expect(sourceExists('../components/canvas/TemplateAdaptation.tsx')).toBe(false)
  })

  it('keeps Saved Object Stamps on the Favorites workbench instead of prototype entry points', () => {
    const appSource = readSource('../app.tsx')
    const favoritesSource = readSource('../components/panels/FavoritesPanel.tsx')

    expect(sourceExists('../components/panels/SavedStampsPrototype.tsx')).toBe(false)
    expect(sourceExists('../components/panels/SavedStampsPrototype.module.css')).toBe(false)
    expect(appSource).not.toContain('stampPrototype')
    expect(appSource).not.toContain('URLSearchParams')
    expect(favoritesSource).toContain('savedObjectStampWorkbench')
    expect(favoritesSource).toContain('saveCanvasSelectionAsObjectStamp')
    expect(favoritesSource).not.toContain('savedObjectStampWorkbench.saveCurrentSelection')
    expect(favoritesSource).toContain('data-saved-stamps-frame')
    expect(favoritesSource).not.toContain('SavedStampsPrototype')
  })

  it('keeps scene runtime panel-target app signals behind an injected adapter', () => {
    const runtimeSource = readSource('../canvas/runtime/scene-runtime.ts')
    const effectsSource = readSource('../canvas/runtime/scene-runtime/effects.ts')
    const adapterSource = readSource('../app/canvas-runtime/panel-target-adapter.ts')
    const presentationSource = readSource('../app/panel-targets/presentation.ts')
    const mapSurfaceControllerSource = readSource('../components/canvas/maplibre-surface-controller.ts')
    const mapSurfaceSnapshotSource = readSource('../app/canvas-map-surface/snapshot.ts')

    expect(runtimeSource).not.toContain('app/panel-targets')
    expect(effectsSource).not.toContain('app/panel-targets')
    expect(adapterSource).toContain('../panel-targets/presentation')
    expect(adapterSource).not.toContain('../panel-targets/state')
    expect(mapSurfaceControllerSource).not.toContain('app/panel-targets/presentation')
    expect(mapSurfaceControllerSource).not.toContain('app/panel-targets/state')
    expect(mapSurfaceSnapshotSource).toContain('../panel-targets/presentation')
    expect(mapSurfaceSnapshotSource).not.toContain('../panel-targets/state')
    expect(presentationSource).toContain('./state')
    expect(presentationSource).toContain('createPanelTargetPresentationController')
  })

  it('keeps core Canvas Map Surface inputs behind the app seam', () => {
    const mapSurfaceControllerSource = readSource('../components/canvas/maplibre-surface-controller.ts')
    const snapshotSource = readSource('../app/canvas-map-surface/snapshot.ts')
    const lifecycleSource = readSource('../app/canvas-map-surface/lifecycle.ts')
    const hostSource = readSource('../maplibre/host.ts')

    expect(mapSurfaceControllerSource).toContain('readCanvasMapSurfaceSnapshot')
    expect(mapSurfaceControllerSource).not.toContain('../../maplibre/loader')
    expect(lifecycleSource).toContain('../../maplibre/surface-adapter')
    expect(lifecycleSource).toContain('../../maplibre/host')
    expect(lifecycleSource).not.toContain('components/canvas/maplibre-loader')
    expect(sourceExists('../components/canvas/maplibre-loader.ts')).toBe(false)
    expect(sourceExists('../maplibre/host.ts')).toBe(true)
    expect(sourceExists('../maplibre/surface-adapter.ts')).toBe(true)
    expect(sourceExists('../maplibre/loader.ts')).toBe(true)
    expectNoImportsMatching('../maplibre/host.ts', [
      /(^|\/)app(\/|$)/,
      /(^|\/)components(\/|$)/,
      /document-session/,
      /canvas-map-surface/,
      /panel-targets/,
    ])
    expect(hostSource).toContain('loadMapLibre')
    expect(hostSource).toContain('createResizeObserver')
    expect(hostSource).toContain('preservedViewState')
    expectNoImportsMatching('../components/canvas/maplibre-surface-controller.ts', [
      /canvas\/session$/,
      /app\/location$/,
      /app\/settings\/state$/,
      /canvas\/scene-metadata-state$/,
      /app\/canvas-settings\/signals$/,
      /app\/panel-targets\/presentation$/,
    ])
    expect(snapshotSource).toContain('currentCanvasQuerySurface')
    expect(snapshotSource).toContain('../canvas-layer-presentation/presentation')
    expect(snapshotSource).toContain('readSavedLocationPresentation')
    expect(snapshotSource).toContain('readPanelTargetOverlaySnapshot')
    expect(snapshotSource).not.toContain('../canvas-settings/signals')
    expect(snapshotSource).toContain('northBearingDeg')
    expect(snapshotSource).toContain('basemapStyle')
    expect(snapshotSource).toContain('theme')
  })

  it('keeps scene layer and guide writes behind the Scene Edit runtime seam', () => {
    const controllerSource = readSource('../app/canvas-settings/controller.ts')
    const layerPresentationSource = readSource('../app/canvas-layer-presentation/presentation.ts')
    const runtimeSource = readSource('../canvas/runtime/scene-runtime.ts')
    const commandSurfaceSource = readSource('../canvas/runtime/command-surface.ts')
    const effectsSource = readSource('../canvas/runtime/scene-runtime/effects.ts')
    const documentSource = readSource('../canvas/runtime/scene-runtime/document.ts')

    expect(controllerSource).toContain('../canvas-layer-presentation/presentation')
    expect(controllerSource).not.toContain('getCurrentCanvasLayerCommandSurface')
    expect(layerPresentationSource).toContain('getCurrentCanvasLayerCommandSurface')
    expect(controllerSource).not.toContain('getCurrentCanvasCommandSurface')
    expect(controllerSource).not.toContain('layerVisibility.value =')
    expect(controllerSource).not.toContain('layerLockState.value =')
    expect(controllerSource).not.toContain('layerOpacity.value =')
    expect(commandSurfaceSource).toContain('setSceneLayerVisibility')
    expect(runtimeSource).toContain("_sceneCommands.run('guide-add'")
    expect(runtimeSource).not.toContain('applySignalBackedSceneState')
    expect(effectsSource).not.toContain('layerVisibility')
    expect(effectsSource).not.toContain('guides')
    expect(documentSource).not.toContain('applySignalBackedSceneState')
  })

  it('keeps production canvas runtime reads off canvas mirror signals', () => {
    const runtimeSources = sourceFilesUnder('../canvas/runtime')
      .filter(isTypescriptSource)
      .filter((path) => path !== '../canvas/runtime/scene-runtime/scene-sync.ts')
    const forbiddenRuntimeImports = [
      /scene-metadata-state$/,
      /runtime-mirror-state$/,
    ]

    for (const sourcePath of runtimeSources) {
      expectNoImportsMatching(sourcePath, forbiddenRuntimeImports)
    }

    const guidesSource = readSource('../canvas/guides.ts')
    const mapSurfaceSnapshotSource = readSource('../app/canvas-map-surface/snapshot.ts')

    expect(guidesSource).not.toContain('scene-metadata-state')
    expect(mapSurfaceSnapshotSource).toContain('readSavedLocationPresentation')
    expect(mapSurfaceSnapshotSource).not.toContain('../document-session/store')
    expect(mapSurfaceSnapshotSource).not.toContain('scene-metadata-state')
  })

  it('keeps focused canvas callers on role-specific command surfaces', () => {
    const focusedCanvasCommandConsumers = [
      '../app/canvas-layer-presentation/presentation.ts',
      '../app/favorites/controller.ts',
      '../components/canvas/PlantColorMenu.tsx',
      '../components/canvas/ZoomControls.tsx',
      '../components/plant-db/PlantCard.tsx',
      '../components/plant-db/PlantRow.tsx',
    ]

    expectNamedImportsFrom('../app/canvas-layer-presentation/presentation.ts', '../../canvas/session', [
      'getCurrentCanvasLayerCommandSurface',
      'currentCanvasQuerySurface',
    ])
    expectNamedImportsFrom('../app/favorites/controller.ts', '../../canvas/session', [
      'currentCanvasSceneEditCommandSurface',
    ])
    expectNamedImportsFrom('../components/canvas/ZoomControls.tsx', '../../canvas/session', [
      'currentCanvasViewportCommandSurface',
    ])
    expectNamedImportsFrom('../components/plant-db/PlantCard.tsx', '../../canvas/session', [
      'currentCanvasToolCommandSurface',
    ])
    expectNamedImportsFrom('../components/plant-db/PlantRow.tsx', '../../canvas/session', [
      'currentCanvasToolCommandSurface',
    ])

    const plantColorMenuImports = namedImportsFrom(
      '../components/canvas/PlantColorMenu.tsx',
      '../../canvas/session',
    )
    expect(plantColorMenuImports).toContain('currentCanvasPlantPresentationCommandSurface')
    expect(plantColorMenuImports).toContain('currentCanvasQuerySurface')
    expect(plantColorMenuImports).toContain('currentCanvasSelection')

    for (const sourcePath of focusedCanvasCommandConsumers) {
      const source = readSource(sourcePath)

      expect(source, `${sourcePath} should not consume the full command bundle`).not.toContain(
        'currentCanvasCommandSurface',
      )
      expect(source, `${sourcePath} should not consume the full command bundle`).not.toContain(
        'getCurrentCanvasCommandSurface',
      )
    }
  })

  it('keeps Canvas Runtime Surface publication explicit', () => {
    const surfacesSource = readSource('../canvas/runtime/surfaces.ts')
    const runtimeSource = readSource('../canvas/runtime/scene-runtime.ts')
    const sessionSource = readSource('../canvas/session.ts')

    expect(surfacesSource).toContain('commands: runtime.commandSurface')
    expect(surfacesSource).toContain('queries: runtime.querySurface')
    expect(surfacesSource).toContain('documents: runtime.documentSurface')
    expect(surfacesSource).not.toContain('?? runtime')
    expect(surfacesSource).not.toContain('maybeRuntime')
    expect(surfacesSource).not.toContain('as SceneCanvasRuntime &')
    expect(runtimeSource).not.toContain('getSceneStore():')
    expect(runtimeSource).not.toContain('\n  setSelection(ids')
    expect(runtimeSource).not.toContain('loadDocument(file')
    expect(sessionSource).toContain('requires explicit canvas runtime surfaces')

    const appFacingTestSources = sourceFilesUnder('./')
      .filter(isTypescriptTestSource)
      .filter((path) => path !== './canvas-runtime-surfaces.test.ts')
      .filter((path) => path !== './frontend-boundaries-sources.test.ts')

    for (const sourcePath of appFacingTestSources) {
      expectNoImportsMatching(sourcePath, [/canvas\/runtime\/scene-runtime$/])
      expect(readSource(sourcePath), `${sourcePath} should not reach into SceneStore`).not.toContain(
        'getSceneStore(',
      )
    }
  })

  it('keeps LayerPanel as a Canvas Layer Presentation renderer', () => {
    const layerPanelSource = readSource('../components/canvas/LayerPanel.tsx')

    expect(layerPanelSource).toContain('../../app/canvas-layer-presentation/presentation')
    expect(layerPanelSource).not.toContain('ALL_LAYERS')
    expect(layerPanelSource).not.toContain('../../app/canvas-settings/state')
    expect(layerPanelSource).not.toContain('../../app/canvas-settings/controller')
    expect(layerPanelSource).not.toContain('useSavedLocationPresentation')
    expect(layerPanelSource).not.toContain("case 'base'")
    expect(layerPanelSource).not.toContain("case 'hillshading'")
  })

  it('keeps Design Object lock authority inside SceneStore', () => {
    const canvasSources = sourceFilesUnder('../canvas')
      .filter(isTypescriptSource)
      .filter((path) => path !== '../canvas/runtime-mirror-state.ts')

    for (const sourcePath of canvasSources) {
      expect(readSource(sourcePath), `${sourcePath} should not read lockedObjectIds`).not.toContain('lockedObjectIds')
    }
  })

  it('keeps Target identity, resolution, and map projection behind the Target module', () => {
    const targetIndexSource = readSource('../target/index.ts')
    const mapOverlaySource = readSource('../maplibre/canvas-overlays.ts')
    const runtimeSource = readSource('../canvas/runtime/scene-runtime.ts')

    expect(sourceExists('../panel-targets.ts')).toBe(false)
    expect(sourceExists('../panel-target-identity.ts')).toBe(false)
    expect(sourceExists('../panel-target-resolution.ts')).toBe(false)
    expect(sourceExists('../panel-target-map-projection.ts')).toBe(false)

    expect(targetIndexSource).toContain('./identity')
    expect(targetIndexSource).toContain('./resolution')
    expect(targetIndexSource).toContain('./map-projection')
    expect(mapOverlaySource).toContain('../target')
    expect(mapOverlaySource).not.toContain('panel-target-map-projection')
    expect(runtimeSource).toContain('../../target')
    expect(runtimeSource).not.toContain('panel-target-identity')
  })

  it('keeps Planning Projection read models out of Canvas2D renderers', () => {
    const projectionSource = readSource('../app/planning-projection/consortium.ts')
    const rendererSource = readSource('../canvas/consortium-renderer.ts')

    expect(projectionSource).not.toContain('consortium-renderer')
    expect(rendererSource).not.toContain('buildConsortiumBars')
    expect(rendererSource).not.toContain('filterActiveConsortiumEntries')
  })

  it('keeps Species Catalog UI behind the workbench seam', () => {
    const sources = [
      readSource('../components/panels/PlantDbPanel.tsx'),
      readSource('../components/panels/FavoritesPanel.tsx'),
      readSource('../components/plant-db/SearchBar.tsx'),
      readSource('../components/plant-db/ResultsList.tsx'),
      readSource('../components/plant-db/FilterStrip.tsx'),
      readSource('../components/plant-db/ActiveChips.tsx'),
      readSource('../components/plant-db/MoreFiltersPanel.tsx'),
      readSource('../components/plant-db/PlantRow.tsx'),
      readSource('../components/plant-db/PlantCard.tsx'),
      readSource('../components/plant-db/ViewModeToggle.tsx'),
    ]

    for (const source of sources) {
      expect(source).toContain('speciesCatalogWorkbench')
      expect(source).not.toContain('plantSearchSession')
      expect(source).not.toContain('dynamicOptionsCache')
      expect(source).not.toContain('dynamicOptionsErrors')
      expect(source).not.toContain('dynamicOptionsPending')
      expect(source).not.toContain('favoriteItems')
      expect(source).not.toContain('favoriteNames')
      expect(source).not.toContain('toggleFavoriteAction')
    }

    for (const source of [
      readSource('../components/plant-db/PlantRow.tsx'),
      readSource('../components/plant-db/PlantCard.tsx'),
    ]) {
      expect(source).toContain('plant-stamp-source')
      expect(source).not.toContain('plantStampSpecies')
      expect(source).not.toContain('JSON.stringify')
      expect(source).not.toContain("setData('text/plain'")
      expect(source).not.toContain('setData("text/plain"')
    }
  })

  it('keeps the live Species Catalog Workbench behind platform adapters', () => {
    const viteSource = readSource('../../vite.config.ts')
    const indexSource = readSource('../app/plant-browser/index.ts')
    const workbenchSource = readSource('../app/plant-browser/workbench.ts')

    expect(viteSource).toContain("'#species-catalog-live'")
    expect(viteSource).toContain('live.browser.ts')
    expect(viteSource).toContain('live.desktop.ts')
    expect(indexSource).toContain('#species-catalog-live')
    expect(workbenchSource).not.toContain('../../ipc/species')
    expect(workbenchSource).not.toContain('../../ipc/favorites')
  })

  it('keeps app commands behind the command graph seam', () => {
    const commandGraphConsumers = [
      '../shortcuts/manager.ts',
      '../components/shared/MenuBar.tsx',
      '../components/panels/PanelBar.tsx',
      '../components/canvas/CanvasToolbar.tsx',
      '../components/shared/menu-definitions.ts',
      '../components/shared/CommandPalette.tsx',
    ]

    expectImportsToContain('../commands/graph/index.ts', [
      './catalog',
      './projections',
      './shortcuts',
    ])
    expectImportsToContain('../commands/graph/projections.ts', ['./catalog'])
    expectImportsToContain('../commands/graph/shortcuts.ts', ['./catalog'])
    expectImportsToContain('../commands/registry.ts', ['./graph'])
    expectNoImportsMatching('../commands/registry.ts', [
      /^\.\/graph\/(catalog|projections|shortcuts)$/,
      /graph\/catalog$/,
      /graph\/projections$/,
      /graph\/shortcuts$/,
      /app\/canvas-settings\/signals$/,
      /app\/settings\/state$/,
      /(^|\/)i18n$/,
      /shortcuts\/definitions$/,
      /canvas\/session$/,
      /canvas\/runtime\/interaction\/pointer-utils$/,
      /app\/shell\/state$/,
    ])
    expectImportsToContain('../shortcuts/manager.ts', ['../commands/registry'])
    expectImportsToContain('../components/shared/MenuBar.tsx', ['./menu-definitions'])
    expectImportsToContain('../components/panels/PanelBar.tsx', ['../../commands/registry'])
    expectImportsToContain('../components/canvas/CanvasToolbar.tsx', ['../../commands/registry'])
    expectImportsToContain('../components/shared/menu-definitions.ts', ['../../commands/registry'])
    expectImportsToContain('../components/shared/CommandPalette.tsx', ['../../commands/registry'])

    for (const sourcePath of commandGraphConsumers) {
      expectNoImportsMatching(sourcePath, [/commands\/graph(\/|$)/])
    }

    expectNoImportsMatching('../shortcuts/manager.ts', [
      /app\/document-session\/actions$/,
      /canvas\/session$/,
    ])
    expectNoImportsMatching('../components/shared/MenuBar.tsx', [
      /document-session\/store$/,
      /canvas\/session$/,
    ])
    expectNoImportsMatching('../components/panels/PanelBar.tsx', [
      /document-session\/store$/,
      /app\/shell\/state$/,
      /app\/settings\/state$/,
    ])
    expectNoImportsMatching('../components/canvas/CanvasToolbar.tsx', [
      /app\/canvas-settings\/signals$/,
    ])
    expectNamedImportsFrom('../components/canvas/CanvasToolbar.tsx', '../../canvas/session', [
      'currentCanvasQuerySurface',
      'currentCanvasSelection',
    ])
    expectNoImportsMatching('../components/shared/CommandPalette.tsx', [
      /shortcuts\/manager$/,
    ])
  })

  it('keeps Design Template import orchestration in the workflow module', () => {
    const communityControllerSource = readSource('../app/community/controller.ts')
    const workflowSource = readSource('../app/design-template-import/workflow.ts')
    const desktopWorkflowSource = readSource('../app/design-template-import/workflow.desktop.ts')
    const browserWorkflowSource = readSource('../app/design-template-import/workflow.browser.ts')
    const desktopCatalogSource = readSource('../app/community/catalog.desktop.ts')
    const browserCatalogSource = readSource('../app/community/catalog.browser.ts')

    expect(communityControllerSource).toContain('../design-template-import/workflow')
    expect(communityControllerSource).toContain('#design-template-catalog')
    expect(communityControllerSource).not.toContain('../../ipc/community')
    expect(communityControllerSource).not.toContain('../document-session/actions')
    expect(communityControllerSource).not.toContain('downloadTemplate')
    expect(workflowSource).toContain('#design-template-import-workflow')
    expect(workflowSource).not.toContain('../../ipc/community')
    expect(workflowSource).not.toContain('../document-session/actions')
    expect(desktopWorkflowSource).toContain('../document-session/actions')
    expect(desktopWorkflowSource).toContain('../../ipc/community')
    expect(browserWorkflowSource).toContain('browser-design-session')
    expect(browserWorkflowSource).not.toContain('../../ipc/community')
    expect(browserWorkflowSource).not.toContain('../document-session/actions')
    expect(browserWorkflowSource).not.toContain('TemplateAdaptation')
    expect(desktopCatalogSource).toContain('../../ipc/community')
    expect(browserCatalogSource).not.toContain('../../ipc/community')
  })

  it('keeps the Design Template world map on the MapLibre Surface Adapter path', () => {
    const worldMapSource = readSource('../components/world-map/WorldMapSurface.tsx')

    expect(worldMapSource).toContain('../../maplibre/surface-adapter')
    expect(worldMapSource).not.toContain("maplibre-gl")
    expect(worldMapSource).not.toContain('createMapLibreBasemapStyle')
    expect(worldMapSource).not.toContain('new ResizeObserver')
  })

  it('keeps production MapLibre ownership in the host and low-level maplibre modules', () => {
    const productionAppSources = [
      '../app',
      '../components',
    ].flatMap(sourceFilesUnder).filter(isTypescriptSource)

    for (const sourcePath of productionAppSources) {
      const source = readSource(sourcePath)

      expectNoImportsMatching(sourcePath, [/^maplibre-gl$/])
      expect(source, `${sourcePath} should not construct basemap styles directly`).not.toContain(
        'createMapLibreBasemapStyle',
      )
      expect(source, `${sourcePath} should not construct MapLibre classes directly`).not.toMatch(
        /\bnew\s+maplibre(?:gl)?\./,
      )
    }
  })

  it('keeps Species Catalog state private to the workbench implementation', () => {
    const sourcePaths = [
      '../app',
      '../components',
    ].flatMap(sourceFilesUnder).filter(isTypescriptSource)
    const forbiddenImports = [
      /(^|\/)plant-browser\/state$/,
      /(^|\/)plant-browser\/controller$/,
      /(^|\/)plant-browser\/search-session$/,
    ]

    for (const sourcePath of sourcePaths) {
      if (sourcePath === '../app/plant-browser/workbench.ts') continue
      expectNoImportsMatching(sourcePath, forbiddenImports)
    }

    const barrelSource = readSource('../app/plant-browser/index.ts')
    expect(barrelSource).not.toContain('./state')
    expect(barrelSource).not.toContain('./controller')
    expect(barrelSource).not.toContain('./search-session')
  })

  it('keeps planning surfaces behind the Planning Projection runtime seam', () => {
    const budgetSource = readSource('../components/canvas/BudgetTab.tsx')
    const timelineSource = readSource('../components/canvas/InteractiveTimeline.tsx')
    const consortiumSource = readSource('../components/canvas/ConsortiumChart.tsx')
    const runtimeSource = readSource('../app/planning-projection/runtime.ts')
    const budgetWorkbenchSource = readSource('../app/budget/workbench.ts')
    const budgetExportSource = readSource('../app/budget/export.ts')

    expect(budgetSource).toContain('app/budget/workbench')
    expect(budgetSource).not.toContain('app/planning-projection')
    expect(budgetSource).not.toContain('app/budget/controller')
    expect(budgetSource).not.toContain('app/budget/export')
    expect(budgetWorkbenchSource).toContain('../planning-projection')
    expect(budgetExportSource).not.toContain('components/canvas')

    for (const source of [budgetSource, timelineSource, consortiumSource]) {
      expect(source).not.toContain('runtime-mirror-state')
      expect(source).not.toContain('currentCanvasQuerySurface')
      expect(source).not.toContain('getPlacedPlants()')
      expect(source).not.toContain('getLocalizedCommonNames()')
      expect(source).not.toContain('document-session/store')
      expect(source).not.toContain('currentDesign')
    }
    expect(runtimeSource).toContain('currentCanvasQuerySurface')
    expect(runtimeSource).toContain('revision.scene.value')
    expect(runtimeSource).not.toContain('runtime-mirror-state')
    expect(runtimeSource).toContain('document-session/store')
  })

  it('keeps runtime mirror revision signals behind the Canvas Query Surface', () => {
    expect(sourceExists('../canvas/runtime-mirror-state.ts')).toBe(false)

    const sourcePaths = [
      '../app',
      '../components',
      '../maplibre',
    ].flatMap(sourceFilesUnder).filter(isTypescriptSource)

    for (const sourcePath of sourcePaths) {
      expectNoImportsMatching(sourcePath, [/canvas\/runtime-mirror-state$/])
    }

    const runtimeSurfaceSource = readSource('../canvas/runtime/runtime.ts')
    const mountedRuntimeSource = readSource('../canvas/runtime/scene-runtime.ts')
    const documentBridgeSource = readSource('../canvas/runtime/scene-runtime/document.ts')
    const sceneAuthoritySource = readSource('../canvas/runtime/scene-runtime/transactions.ts')
    const mapSurfaceSnapshotSource = readSource('../app/canvas-map-surface/snapshot.ts')
    const consortiumWorkflowSource = readSource('../app/consortium/workflow.ts')

    expect(runtimeSurfaceSource).toContain('CanvasQueryRevision')
    expect(mountedRuntimeSource).toContain('_incrementSceneRevision')
    expect(sceneAuthoritySource).toContain('incrementSceneRevision')
    expect(documentBridgeSource).not.toContain('incrementSceneRevision')
    expect(documentBridgeSource).not.toContain('sceneEntityRevision')
    expect(consortiumWorkflowSource).toContain('getSettledPlacedPlants()')
    expect(consortiumWorkflowSource).not.toContain('getPlacedPlants()')
    expect(sourceExists('../app/document/controller.ts')).toBe(false)
    expect(sourceExists('../app/document/edit-transaction.ts')).toBe(false)
    expect(sourceExists('../app/budget/controller.ts')).toBe(false)
    expect(sourceExists('../app/timeline/controller.ts')).toBe(false)
    expect(sourceExists('../app/consortium/controller.ts')).toBe(false)
    expectImportsToContain('../app/document-session/workflows.ts', ['../consortium/workflow'])
    expectNoImportsMatching('../app/document-session/workflows.ts', [
      /@preact\/signals$/,
      /canvas\/session$/,
      /document\/controller$/,
      /document-session\/store$/,
      /consortium\/time-model$/,
    ])
    expectImportsToContain('../app/consortium/workflow.ts', [
      '../../canvas/session',
      '../design-edit',
      '../document-session/store',
      '../document-session/workflow-runner',
      './time-model',
    ])
    expectNoImportsMatching('../app/consortium/workflow.ts', [
      /document-session\/lifecycle$/,
      /document-session\/state-machine$/,
      /document-session\/workflows$/,
    ])
    expect(mapSurfaceSnapshotSource).toContain('revision.viewport.value')
  })

  it('keeps non-canvas Design writes behind the Design Edit seam', () => {
    const sourcePaths = [
      '../app',
      '../components',
    ].flatMap(sourceFilesUnder).filter(isTypescriptSource)

    for (const sourcePath of sourcePaths) {
      if (sourcePath.startsWith('../app/design-edit/')) continue
      expectNoImportsMatching(sourcePath, [
        /document\/controller$/,
        /document\/edit-transaction$/,
        /budget\/controller$/,
        /timeline\/controller$/,
        /consortium\/controller$/,
      ])
    }

    expectImportsToContain('../app/design-edit/core.ts', ['../document-session/store'])
    expectImportsToContain('../app/location/controller.ts', ['../design-edit'])
    expectImportsToContain('../app/budget/workbench.ts', ['../design-edit'])
    expectImportsToContain('../app/timeline/workbench.ts', ['../design-edit'])
    expectImportsToContain('../app/timeline/interaction.ts', ['../design-edit'])
    expectImportsToContain('../app/consortium/interaction.ts', ['../design-edit'])
    expectImportsToContain('../app/consortium/workflow.ts', ['../design-edit'])
  })

  it('keeps Target presentation lifecycle out of Planning Projection', () => {
    const planningIndexSource = readSource('../app/planning-projection/index.ts')
    const budgetWorkbenchSource = readSource('../app/budget/workbench.ts')
    const timelineWorkbenchSource = readSource('../app/timeline/workbench.ts')
    const consortiumWorkbenchSource = readSource('../app/consortium/workbench.ts')
    const targetPresentationSource = readSource('../app/panel-targets/presentation.ts')

    expect(sourceExists('../app/planning-projection/target-presentation.ts')).toBe(false)
    expect(planningIndexSource).not.toContain('target-presentation')
    expect(planningIndexSource).not.toContain('PlanningSelection')
    expect(targetPresentationSource).toContain('PanelTargetPresentationController')
    expect(targetPresentationSource).toContain('dispose()')

    for (const source of [budgetWorkbenchSource, timelineWorkbenchSource, consortiumWorkbenchSource]) {
      expect(source).toContain('../panel-targets/presentation')
      expect(source).not.toContain('clearPlanning')
      expect(source).not.toContain('setPlanning')
      expect(source).not.toContain('readPlanning')
    }
  })

  it('keeps the canvas document hook as a Design Session lifecycle adapter', () => {
    const hookSource = readSource('../app/document-session/use-canvas-document-session.ts')
    const lifecycleSource = readSource('../app/document-session/lifecycle.ts')
    const actionsSource = readSource('../app/document-session/actions.ts')
    const transitionSource = readSource('../app/document-session/transition.ts')
    const stateMachineSource = readSource('../app/document-session/state-machine.ts')
    const browserSessionSource = readSource('../web/browser-design-session.ts')
    const persistenceSource = readSource('../app/document-session/persistence.ts')
    const designIpcSource = readSource('../ipc/design.ts')
    const webWorkspaceSource = readSource('../web/WebCanvasWorkspace.tsx')

    expectImportsToContain('../app/document-session/use-canvas-document-session.ts', ['./lifecycle'])
    expect(hookSource).not.toContain('SceneCanvasRuntime')
    expect(hookSource).not.toContain('transitionDocument')
    expect(hookSource).not.toContain('buildPersistedDesignSessionContent')
    expect(hookSource).not.toContain('autosaveDesign')
    expect(lifecycleSource).toContain('createAppCanvasRuntimeHost')
    expect(lifecycleSource).not.toContain('SceneCanvasRuntime')
    expect(lifecycleSource).not.toContain('createCanvasRuntimeSurfaces')
    expect(lifecycleSource).toContain('startAttachedDesignSession')
    expect(lifecycleSource).toContain('abortFailedAttachedDesignSessionStart')
    expect(lifecycleSource).toContain('autosaveDesignSession')
    expect(lifecycleSource).toContain('teardownAttachedDesignSession')
    expect(lifecycleSource).not.toContain('transitionDocument')
    expect(lifecycleSource).not.toContain('buildPersistedDesignSessionContent')
    expect(lifecycleSource).not.toContain('../../ipc/design')
    expect(actionsSource).not.toContain('transitionDocument')
    expect(transitionSource).toContain('createDesignSessionStateMachine')
    expect(stateMachineSource).toContain('transitionDocument')
    expect(stateMachineSource).toContain('createDesignSessionPersistence')
    expect(stateMachineSource).toContain('.beginSave(')
    expect(stateMachineSource).toContain('.beginSaveAs(')
    expect(stateMachineSource).toContain('.beginRecovery(')
    expect(stateMachineSource).toContain('.execute(')
    expect(stateMachineSource).not.toContain('.succeed(')
    expect(stateMachineSource).not.toContain('.fail(')
    expect(stateMachineSource).not.toContain('buildPersistedDesignSessionContent')
    expect(stateMachineSource).not.toContain('.markSaved(')
    expect(stateMachineSource).not.toContain('replaceCurrentDesignState(')
    expect(stateMachineSource).toContain('autosaveDesign')
    expectImportsToContain('../app/document-session/state-machine.ts', [
      './persistence',
      './replacement',
      './workflow-runner',
      './workflows',
    ])
    expect(stateMachineSource).not.toContain('applyDocumentTransition')
    expectNoImportsMatching('../app/document-session/replacement.ts', [
      /@tauri-apps/,
      /(^|\/)ipc(\/|$)/,
      /(^|\/)web(\/|$)/,
    ])
    expectImportsToContain('../web/browser-design-session.ts', [
      '../app/document-session/persistence',
      '../app/document-session/replacement',
    ])
    expect(browserSessionSource).toContain('createDesignSessionPersistence')
    expect(browserSessionSource).toContain('.beginBrowserDownload(')
    expect(browserSessionSource).toContain('.beginBrowserDraft(')
    expect(browserSessionSource).toContain('.execute(')
    expect(browserSessionSource).toContain('.executeImmediately(')
    expect(browserSessionSource).not.toContain('operation.content')
    expect(browserSessionSource).not.toContain('operation.succeed')
    expect(browserSessionSource).not.toContain('operation.fail')
    expect(browserSessionSource).not.toContain('settleWrittenDesignOperation')
    expect(browserSessionSource).not.toContain('buildPersistedDesignSessionContent')
    expect(browserSessionSource).not.toContain('.markSaved(')
    expect(browserSessionSource).not.toContain('replaceCurrentDesignState(')
    expect(browserSessionSource).not.toContain('normalizeLoadedDocument')
    expect(browserSessionSource).not.toContain('normalizeNewDocument')
    expect(webWorkspaceSource).not.toContain('syncCanvasDocument')
    expect(webWorkspaceSource).not.toContain('useSignalEffect')
    expect(webWorkspaceSource).not.toContain('.replaceDocument(')
    expect(webWorkspaceSource).not.toContain('.loadDocument(')
    expectNoImportsMatching('../app/document-session/persistence.ts', [
      /consortium\/workflow$/,
      /document-session\/workflow-runner$/,
      /document-session\/workflows$/,
      /canvas\/runtime\/scene-runtime\/transactions$/,
    ])
    expect(persistenceSource).not.toContain('SceneEditBusyError')
    expect(persistenceSource).not.toContain('DesignPersistenceWriteOperation')
    expect(persistenceSource).not.toContain('settleWrittenDesignOperation')
    expect(persistenceSource).not.toContain('succeed():')
    expect(persistenceSource).not.toContain('fail(error?: unknown)')
    expect(designIpcSource).not.toContain('function saveDesignAs(')
    expect(designIpcSource).not.toContain('export async function saveDesign(')
    expect(designIpcSource).not.toContain('export async function autosaveDesign(')
  })

  it('confines prepared Design write destinations to persistence adapters', () => {
    const importers = sourceFilesUnder('../')
      .filter(isTypescriptSource)
      .filter((sourcePath) => importSpecifiers(readSource(sourcePath)).some(
        (specifier) => specifier === './write-admission'
          || specifier.endsWith('/document-session/write-admission'),
      ))
      .sort()

    expect(importers).toEqual([
      '../app/document-session/persistence.ts',
      '../ipc/design.ts',
      '../web/browser-design-session.ts',
    ])
  })

  it('routes canvas clean-state reporting through the Canvas Runtime App Adapter', () => {
    const historySource = readSource('../canvas/runtime/scene-history.ts')
    const constructionSource = readSource('../canvas/runtime/scene-runtime/construction.ts')
    const runtimeAdapterSource = readSource('../canvas/runtime/app-adapter.ts')
    const appAdapterSource = readSource('../app/canvas-runtime/app-adapter.ts')
    const hostSource = readSource('../app/canvas-runtime/host.ts')

    expect(historySource).toContain('reportCleanState')
    expect(constructionSource).toContain('CanvasRuntimeAppAdapter')
    expect(runtimeAdapterSource).toContain('CanvasRuntimeCleanStateAdapter')
    expect(appAdapterSource).toContain('setCanvasClean')
    expect(hostSource).toContain('createAppCanvasRuntimeAppAdapter')
    expectImportsToContain('../app/canvas-runtime/app-adapter.ts', ['../document-session/store'])
    expectNoImportsMatching('../canvas/runtime/scene-history.ts', [
      /app\/document-session\/store$/,
    ])
    expectNoImportsMatching('../canvas/runtime/scene-runtime.ts', [
      /app\/document-session\/store$/,
    ])
    expectNoImportsMatching('../canvas/runtime/scene-runtime/construction.ts', [
      /app\/document-session\/store$/,
    ])
  })

  it('routes Design file composition through the Canvas Runtime App Adapter', () => {
    const documentBridgeSource = readSource('../canvas/runtime/scene-runtime/document.ts')
    const runtimeAdapterSource = readSource('../canvas/runtime/app-adapter.ts')
    const appAdapterSource = readSource('../app/canvas-runtime/app-adapter.ts')

    expect(documentBridgeSource).toContain('composeDocumentForSave')
    expect(runtimeAdapterSource).toContain('CanvasRuntimeDocumentAdapter')
    expect(appAdapterSource).toContain('composeDocumentForSave')
    expectImportsToContain('../app/canvas-runtime/app-adapter.ts', ['../contracts/document'])
    expectNoImportsMatching('../canvas/runtime/scene-runtime/document.ts', [
      /app\/contracts\/document$/,
    ])
    expectNoImportsMatching('../canvas/runtime/scene-runtime.ts', [
      /app\/contracts\/document$/,
    ])
  })

  it('passes settled Saved Object Stamp captures through the Canvas Runtime App Adapter', () => {
    const commandSurfaceSource = readSource('../canvas/runtime/command-surface.ts')
    const runtimeAdapterSource = readSource('../canvas/runtime/app-adapter.ts')
    const appAdapterSource = readSource('../app/canvas-runtime/app-adapter.ts')
    const workbenchSource = readSource('../app/saved-object-stamps/workbench.ts')

    expect(runtimeAdapterSource).toContain('CanvasRuntimeSavedObjectStampCapture')
    expect(commandSurfaceSource).toContain('getDesignObjectSelectionModel')
    expect(commandSurfaceSource).toContain('localizedCommonNames: new Map')
    expect(appAdapterSource).toContain('saveSelection(capture)')
    expect(workbenchSource).not.toContain('saveCurrentSelection')
  })

  it('routes shared runtime settings through the Canvas Runtime App Adapter', () => {
    const appAdapterSource = readSource('../app/canvas-runtime/app-adapter.ts')
    const runtimeAdapterSource = readSource('../canvas/runtime/app-adapter.ts')

    expect(runtimeAdapterSource).toContain('CanvasRuntimeSettingsAdapter')
    expect(appAdapterSource).toContain('mutateSettingsProjection')
    expect(appAdapterSource).toContain('snapToGridEnabled')
    expect(appAdapterSource).toContain('layerVisibility')

    for (const sourcePath of [
      '../canvas/runtime/scene-runtime.ts',
      '../canvas/runtime/scene-runtime/effects.ts',
      '../canvas/runtime/scene-runtime/scene-sync.ts',
      '../canvas/runtime/scene-interaction.ts',
    ]) {
      expectNoImportsMatching(sourcePath, [
        /app\/settings\//,
        /app\/canvas-settings\//,
      ])
    }
  })

  it('routes canvas presentation data through the Canvas Runtime App Adapter', () => {
    const constructionSource = readSource('../canvas/runtime/scene-runtime/construction.ts')
    const runtimeAdapterSource = readSource('../canvas/runtime/app-adapter.ts')
    const appAdapterSource = readSource('../app/canvas-runtime/app-adapter.ts')
    const hostSource = readSource('../app/canvas-runtime/host.ts')
    const browserRuntimeSource = readSource('../web/browser-canvas-runtime.ts')

    expect(runtimeAdapterSource).toContain('CanvasRuntimePresentationDataAdapter')
    expect(constructionSource).toContain('appAdapter.presentationData')
    expect(constructionSource).toContain('presentationData?.plantLabels')
    expect(constructionSource).toContain('presentationData?.speciesCache')
    expect(appAdapterSource).toContain('CanvasPlantLabelResolver')
    expect(appAdapterSource).toContain('CanvasSpeciesCache')
    expect(hostSource).not.toContain('CanvasPlantLabelResolver')
    expect(hostSource).not.toContain('CanvasSpeciesCache')
    expect(browserRuntimeSource).toContain('createDetachedCanvasPlantLabelSource')
    expect(browserRuntimeSource).not.toContain('CanvasPlantLabelResolver')
    expectNoImportsMatching('../canvas/runtime/scene-runtime/construction.ts', [
      /plant-labels$/,
      /species-cache$/,
    ])
  })

  it('keeps production Canvas Runtime core free of direct app imports', () => {
    const runtimeSourcePaths = sourceFilesUnder('../canvas/runtime').filter(isTypescriptSource)

    expect(runtimeSourcePaths).toContain('../canvas/runtime/app-adapter.ts')
    expectImportsToContain('../app/canvas-runtime/app-adapter.ts', [
      '../../canvas/runtime/app-adapter',
    ])

    for (const sourcePath of runtimeSourcePaths) {
      expectNoImportsMatching(sourcePath, [
        /(^|\/)app(\/|$)/,
      ])
    }
  })

  it('keeps the Problem Report dialog behind the submission module', () => {
    const dialogSource = readSource('../components/shared/ProblemReportDialog.tsx')

    expect(dialogSource).toContain('problemReportSubmission')
    expect(dialogSource).not.toContain('recentFrontendDiagnostics')
    expect(dialogSource).not.toContain('buildCurrentDesignProblemReportAttachment')
    expect(dialogSource).not.toContain('../../ipc/problem-report')
    expect(dialogSource).not.toContain('ProblemReportRequest')
  })

  it('routes Problem Report Design observation through the owning session transition seam', () => {
    const attachmentSource = readSource('../app/problem-report/attachments.ts')

    expect(attachmentSource).toContain("from '../document-session/transition'")
    expect(attachmentSource).not.toContain("from '../document-session/persistence'")
    expect(attachmentSource).not.toContain("from '../document-session/store'")
    expect(attachmentSource).not.toContain("from '../../canvas/session'")
  })

  it('keeps production Design Session state behind the store seam', () => {
    const sourcePaths = [
      '../app',
      '../canvas',
      '../components',
      '../ipc',
    ].flatMap(sourceFilesUnder).filter(isTypescriptSource)

    for (const sourcePath of sourcePaths) {
      if (sourcePath === '../app/document-session/store.ts') continue
      expectNoImportsMatching(sourcePath, [/state\/design$/])
    }
  })

  it('confines raw Design persistence captures to the persistence module', () => {
    const storeSource = readSource('../app/document-session/store.ts')
    const publicStoreContract = storeSource.slice(
      storeSource.indexOf('export interface DesignSessionStore {'),
      storeSource.indexOf('\n}\n\ndeclare const persistenceCapableDesignSessionStoreBrand'),
    )
    expect(publicStoreContract).not.toContain('capturePersistence')

    const sourcePaths = sourceFilesUnder('..')
      .filter(isTypescriptSource)
      .filter((sourcePath) => !sourcePath.startsWith('../__tests__/'))
    for (const sourcePath of sourcePaths) {
      if (
        sourcePath === '../app/document-session/persistence-capability.ts'
        || sourcePath === '../app/document-session/persistence.ts'
      ) continue
      expect(readSource(sourcePath)).not.toContain('captureDesignSessionPersistenceState')
    }

    for (const sourcePath of sourcePaths) {
      const source = readSource(sourcePath)
      if (
        sourcePath !== '../app/document-session/persistence-capability.ts'
        && sourcePath !== '../app/document-session/persistence.ts'
        && sourcePath !== '../app/document-session/store.ts'
      ) {
        expect(source, sourcePath).not.toContain('persistence-capability')
      }
      if (
        sourcePath !== '../app/document-session/persistence-capability.ts'
        && sourcePath !== '../app/document-session/store.ts'
      ) {
        expect(source, sourcePath).not.toContain('registerDesignSessionPersistenceCapability')
      }
    }

    const appLevelSourcePaths = [
      '../app',
      '../components',
      '../ipc',
      '../state',
      '../web',
    ].flatMap(sourceFilesUnder).filter(isTypescriptSource)
    for (const sourcePath of appLevelSourcePaths) {
      if (sourcePath === '../app/document-session/persistence.ts') continue
      expect(readSource(sourcePath), sourcePath).not.toMatch(/\.captureForPersistence\s*\(/)
    }
  })

  it('keeps tests behind the Design Session test adapter', () => {
    const sourcePaths = [
      '../__tests__',
      '../canvas',
    ].flatMap(sourceFilesUnder).filter(isTypescriptTestSource)
    const adapterSource = readSource('../__tests__/support/design-session-state.ts')

    for (const sourcePath of sourcePaths) {
      expectNoImportsMatching(sourcePath, [/state\/design$/])
    }

    expect(adapterSource).toContain('../../state/design')
  })

  it('keeps Planning Canvas interaction lifetime behind its planning-specific frame', () => {
    const planningFrameSource = readSource('../app/planning-canvas/interaction-frame.ts')
    const sceneSessionSource = readSource('../canvas/runtime/scene-interaction.ts')
    const planningSurfaceSources = [
      '../app/timeline/canvas/host-model.ts',
      '../app/timeline/canvas/controller.ts',
      '../app/timeline/canvas/interaction-frame.ts',
      '../app/consortium/workbench.ts',
      '../components/canvas/InteractiveTimeline.tsx',
      '../components/canvas/ConsortiumChart.tsx',
    ]

    expect(planningFrameSource).toContain('createPlanningCanvasInteractionFrame')
    expect(planningFrameSource).toContain('installDocumentListeners')
    expect(planningFrameSource).toContain('syncVisibleItems')
    expect(planningFrameSource).toContain('handleWheel?:')
    expect(planningFrameSource).not.toContain('SceneInteraction')
    expect(sceneSessionSource).not.toContain('planning-canvas')
    expectNoImportsMatching('../app/planning-canvas/interaction-frame.ts', [
      /canvas\/runtime\/interaction/,
    ])

    for (const sourcePath of planningSurfaceSources) {
      const source = readSource(sourcePath)
      expect(source, sourcePath).not.toContain('document.addEventListener')
      expect(source, sourcePath).not.toContain('document.removeEventListener')
    }
  })

  it('keeps Timeline Action Canvas behavior behind one app/timeline/canvas module seam', () => {
    const timelineSource = readSource('../components/canvas/InteractiveTimeline.tsx')
    const canvasIndexSource = readSource('../app/timeline/canvas/index.ts')
    const canvasHostSource = readSource('../app/timeline/canvas/host-model.ts')
    const canvasControllerSource = readSource('../app/timeline/canvas/controller.ts')
    const canvasGeometrySource = readSource('../app/timeline/canvas/geometry.ts')
    const interactionFrameSource = readSource('../app/timeline/canvas/interaction-frame.ts')
    const planningInteractionFrameSource = readSource('../app/planning-canvas/interaction-frame.ts')
    const interactionSource = readSource('../app/timeline/interaction.ts')
    const editingSource = readSource('../app/timeline/editing.ts')
    const designEditTimelineSource = readSource('../app/design-edit/timeline.ts')
    const workbenchSource = readSource('../app/timeline/workbench.ts')

    expect(sourceExists('../app/timeline/canvas-workbench.ts')).toBe(false)
    expect(sourceExists('../app/timeline/interaction-workbench.ts')).toBe(false)
    expect(sourceExists('../app/timeline/interaction-frame.ts')).toBe(false)
    expect(timelineSource).not.toContain('beginDocumentArrayEdit')
    expect(timelineSource).not.toContain('beginTimelineActionEdit')
    expect(timelineSource).not.toContain('computeTimelineAutoScrollSpeed')
    expect(timelineSource).not.toContain('applyTimelineActionPatch')
    expect(timelineSource).not.toContain('currentDesign')
    expect(timelineSource).not.toContain('../app/timeline/controller')
    expect(timelineSource).not.toContain('createTimelineActionFromFormData')
    expect(timelineSource).not.toContain('formDataFromTimelineAction')
    expect(timelineSource).not.toContain('timelineActionPatchFromFormData')
    expect(timelineSource).not.toContain('renderTimeline')
    expect(timelineSource).not.toContain('theme.value')
    expect(timelineSource).not.toContain('workbench.')
    expectNoImportsMatching('../components/canvas/InteractiveTimeline.tsx', [
      /settings\/state$/,
      /timeline-renderer$/,
    ])
    expect(timelineSource).toContain('../app/timeline/canvas')
    expect(timelineSource).toContain('useTimelineActionCanvasHostModel')
    expect(timelineSource).toContain('hostModel.container')
    expect(timelineSource).toContain('hostModel.canvas')
    expect(timelineSource).toContain('hostModel.renderer')
    expect(timelineSource).toContain('hostModel.overlays')
    expect(canvasIndexSource).toContain('./host-model')
    expect(canvasIndexSource).not.toContain('./controller')
    expect(canvasIndexSource).not.toContain('./interaction-frame')
    expect(canvasHostSource).toContain('TimelineActionCanvasHostModel')
    expect(canvasHostSource).toContain('renderTimeline')
    expect(canvasHostSource).toContain('./controller')
    expect(canvasHostSource).toContain('readGeometry')
    expect(canvasHostSource).not.toContain('computeTimelineRowOffsets')
    expectNoImportsMatching('../app/timeline/canvas/host-model.ts', [
      /^\.\/interaction-frame$/,
      /^\.\.\/interaction$/,
    ])
    expect(canvasHostSource).toContain('../workbench')
    expect(canvasHostSource).not.toContain('hitTestAction')
    expect(canvasHostSource).not.toContain('createTimelineMoveDrag')
    expect(canvasHostSource).not.toContain('createTimelineResizeDrag')
    expect(canvasHostSource).not.toContain('timelineAutoScrollSpeed')
    expect(canvasHostSource).not.toContain('restoreTimelineOriginScroll')
    expect(canvasHostSource).not.toContain('setTimelineHoveredPanelTargets')
    expect(canvasHostSource).not.toContain('setTimelineSelectedPanelTargets')
    expect(canvasHostSource).not.toContain('deleteSelectedTimelineAction')
    expect(canvasHostSource).not.toContain('saveTimelineActionPopover')
    expect(canvasHostSource).not.toContain('deleteTimelineActionPopover')
    expect(canvasHostSource).not.toContain('openTimelineActionPopover')
    expect(canvasHostSource).not.toContain('isEditableTarget')
    expect(canvasHostSource).toContain('installDocumentListeners')
    expect(canvasHostSource).not.toContain('document.addEventListener')
    expect(canvasHostSource).not.toContain('document.removeEventListener')
    expect(canvasControllerSource).toContain('./interaction-frame')
    expect(canvasControllerSource).toContain('createTimelineActionInteractionFrame')
    expect(canvasControllerSource).toContain('installDocumentListeners')
    expect(canvasControllerSource).toContain('view:')
    expect(canvasControllerSource).toContain('popover:')
    expect(canvasControllerSource).toContain('selection:')
    expect(canvasControllerSource).toContain('hover:')
    expect(canvasControllerSource).toContain('createTimelineActionCanvasGeometry')
    expect(canvasControllerSource).toContain('geometryRef')
    expect(canvasGeometrySource).toContain('createTimelineActionCanvasGeometry')
    expect(canvasGeometrySource).toContain('hitTestTimelineActionGeometry')
    expect(canvasGeometrySource).toContain('findTimelineActionTypeAtY')
    expect(canvasGeometrySource).toContain('TIMELINE_LABEL_SIDEBAR_WIDTH')
    expect(canvasGeometrySource).toContain('TIMELINE_RULER_HEIGHT')
    expect(interactionFrameSource).toContain('hitTestTimelineActionGeometry')
    expect(interactionFrameSource).toContain('findTimelineActionTypeAtY')
    expect(interactionFrameSource).toContain('geometryRef')
    expect(interactionFrameSource).not.toContain('hitTestAction')
    expect(interactionFrameSource).not.toContain('hitTestTimelineRulerControls')
    expect(interactionFrameSource).not.toContain('nextTimelineGranularity')
    expect(interactionFrameSource).toContain('createTimelineMoveDrag')
    expect(interactionFrameSource).toContain('createTimelineResizeDrag')
    expect(interactionFrameSource).toContain('timelineAutoScrollSpeed')
    expect(interactionFrameSource).toContain('restoreTimelineOriginScroll')
    expect(interactionFrameSource).toContain('../../planning-canvas/interaction-frame')
    expect(interactionFrameSource).toContain('createPlanningCanvasInteractionFrame')
    expect(interactionFrameSource).not.toContain('setTimelineHoveredPanelTargets')
    expect(interactionFrameSource).not.toContain('setTimelineSelectedPanelTargets')
    expect(interactionFrameSource).not.toContain('clearTimelineHoveredPanelTargets')
    expect(interactionFrameSource).not.toContain('clearTimelineSelectedPanelTargets')
    expect(interactionFrameSource).toContain('deleteSelectedTimelineAction')
    expect(interactionFrameSource).toContain('saveTimelineActionPopover')
    expect(interactionFrameSource).toContain('deleteTimelineActionPopover')
    expect(interactionFrameSource).toContain('openTimelineActionPopover')
    expect(interactionFrameSource).toContain('isEditableTarget')
    expect(planningInteractionFrameSource).toContain('installDocumentListeners')
    expect(planningInteractionFrameSource).toContain('syncVisibleItems')
    expect(interactionSource).toContain('beginTimelineActionEdit')
    expect(interactionSource).toContain('computeTimelineAutoScrollSpeed')
    expect(interactionSource).toContain('../design-edit')
    expect(interactionSource).not.toContain('rulerControlBounds')
    expect(interactionSource).not.toContain('hitTestTimelineRulerControls')
    expect(editingSource).not.toContain('beginDocumentArrayEdit')
    expect(editingSource).not.toContain('applyTimelineActionPatch')
    expect(designEditTimelineSource).toContain('beginDesignArrayEdit')
    expect(designEditTimelineSource).toContain('applyTimelineActionPatch')
    expect(workbenchSource).toContain('../planning-projection')
    expect(workbenchSource).toContain('../design-edit')
    expect(workbenchSource).toContain('createTimelineTargetPresentation')
    expect(workbenchSource).toContain('createTimelineActionFromFormData')
    expect(workbenchSource).toContain('formDataFromTimelineAction')
    expect(workbenchSource).toContain('timelineActionPatchFromFormData')
  })

  it('keeps Consortium document drag edits behind the Consortium interaction module', () => {
    const consortiumSource = readSource('../components/canvas/ConsortiumChart.tsx')
    const workbenchSource = readSource('../app/consortium/workbench.ts')
    const interactionSource = readSource('../app/consortium/interaction.ts')

    expect(consortiumSource).not.toContain('beginDocumentArrayEdit')
    expect(consortiumSource).not.toContain('moveConsortiumEntryInArray')
    expect(consortiumSource).not.toContain('reorderConsortiumEntryInArray')
    expect(consortiumSource).toContain('../app/consortium/workbench')
    expect(workbenchSource).toContain('./interaction')
    expect(workbenchSource).toContain('../planning-canvas/interaction-frame')
    expect(workbenchSource).toContain('createPlanningCanvasInteractionFrame')
    expect(workbenchSource).toContain('installDocumentListeners')
    expect(workbenchSource).toContain('syncVisibleItems')
    expect(workbenchSource).toContain('hitTestBar')
    expect(workbenchSource).not.toContain('document.addEventListener')
    expect(workbenchSource).not.toContain('document.removeEventListener')
    expect(workbenchSource).not.toContain('setHoveredSpecies')
    expect(interactionSource).toContain('../design-edit')
    expect(interactionSource).toContain('beginConsortiumDocumentEdit')
    expect(interactionSource).toContain('moveConsortiumEntryInArray')
    expect(interactionSource).not.toContain('reorderConsortiumEntryInArray')
  })
})
