import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'

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

describe('frontend boundary sources', () => {
  it('keeps the remaining workflow components free of direct ipc imports', () => {
    const adaptationSource = readSource('../components/canvas/TemplateAdaptation.tsx')
    const welcomeSource = readSource('../components/shared/WelcomeScreen.tsx')
    const budgetSource = readSource('../components/canvas/BudgetTab.tsx')

    expect(adaptationSource).not.toContain('ipc/adaptation')
    expect(welcomeSource).not.toContain('ipc/design')
    expect(budgetSource).not.toContain('ipc/design')
  })

  it('keeps Site Adaptation sibling to the Species Catalog Workbench', () => {
    const siteAdaptationSources = [
      '../app/adaptation/index.ts',
      '../app/adaptation/controller.ts',
      '../components/canvas/TemplateAdaptation.tsx',
    ]
    const forbiddenImports = [
      /(^|\/)app\/plant-browser(\/|$)/,
      /(^|\/)plant-browser(\/|$)/,
      /(^|\/)components\/plant-db(\/|$)/,
      /(^|\/)plant-db(\/|$)/,
      /(^|\/)components\/plant-detail(\/|$)/,
      /(^|\/)plant-detail(\/|$)/,
    ]

    for (const sourcePath of siteAdaptationSources) {
      const source = readSource(sourcePath)

      expect(source).not.toContain('speciesCatalogWorkbench')
      expectNoImportsMatching(sourcePath, forbiddenImports)
    }
  })

  it('keeps scene runtime panel-target app signals behind an injected adapter', () => {
    const runtimeSource = readSource('../canvas/runtime/scene-runtime.ts')
    const effectsSource = readSource('../canvas/runtime/scene-runtime/effects.ts')
    const adapterSource = readSource('../app/canvas-runtime/panel-target-adapter.ts')
    const presentationSource = readSource('../app/panel-targets/presentation.ts')
    const mapSurfaceControllerSource = readSource('../components/canvas/maplibre-surface-controller.ts')

    expect(runtimeSource).not.toContain('app/panel-targets')
    expect(effectsSource).not.toContain('app/panel-targets')
    expect(adapterSource).toContain('../panel-targets/presentation')
    expect(adapterSource).not.toContain('../panel-targets/state')
    expect(mapSurfaceControllerSource).toContain('app/panel-targets/presentation')
    expect(mapSurfaceControllerSource).not.toContain('app/panel-targets/state')
    expect(presentationSource).toContain('./state')
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
      readSource('../components/plant-db/SortSelect.tsx'),
      readSource('../components/plant-detail/RelationshipList.tsx'),
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
  })

  it('keeps app commands behind the command graph seam', () => {
    const registrySource = readSource('../commands/registry.ts')
    const shortcutManagerSource = readSource('../shortcuts/manager.ts')
    const menuDefinitionsSource = readSource('../components/shared/menu-definitions.ts')
    const commandPaletteSource = readSource('../components/shared/CommandPalette.tsx')

    expect(registrySource).toContain('getMenuDefinitions')
    expect(registrySource).toContain('handleAppCommandKeyDown')
    expect(registrySource).toContain('runAppCommand')
    expect(shortcutManagerSource).toContain('../commands/registry')
    expect(shortcutManagerSource).not.toContain('../app/document-session/actions')
    expect(shortcutManagerSource).not.toContain('../canvas/session')
    expect(menuDefinitionsSource).toContain('../../commands/registry')
    expect(commandPaletteSource).toContain('../../commands/registry')
    expect(commandPaletteSource).not.toContain('../../shortcuts/manager')
  })

  it('keeps Design Template import orchestration in the workflow module', () => {
    const communityControllerSource = readSource('../app/community/controller.ts')
    const workflowSource = readSource('../app/design-template-import/workflow.ts')

    expect(communityControllerSource).toContain('../design-template-import/workflow')
    expect(communityControllerSource).not.toContain('../document-session/actions')
    expect(communityControllerSource).not.toContain('downloadTemplate')
    expect(workflowSource).toContain('../document-session/actions')
    expect(workflowSource).toContain('../../ipc/community')
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

    for (const source of [budgetSource, timelineSource, consortiumSource]) {
      expect(source).not.toContain('runtime-mirror-state')
      expect(source).not.toContain('currentCanvasQuerySurface')
      expect(source).not.toContain('getPlacedPlants()')
      expect(source).not.toContain('getLocalizedCommonNames()')
    }
    expect(runtimeSource).toContain('runtime-mirror-state')
    expect(runtimeSource).toContain('currentCanvasQuerySurface')
  })

  it('keeps the canvas document hook as a Design Session lifecycle adapter', () => {
    const hookSource = readSource('../app/document-session/use-canvas-document-session.ts')
    const lifecycleSource = readSource('../app/document-session/lifecycle.ts')
    const transitionSource = readSource('../app/document-session/transition.ts')
    const stateMachineSource = readSource('../app/document-session/state-machine.ts')

    expect(hookSource).toContain('./lifecycle')
    expect(hookSource).not.toContain('SceneCanvasRuntime')
    expect(hookSource).not.toContain('transitionDocument')
    expect(hookSource).not.toContain('buildPersistedDesignSessionContent')
    expect(hookSource).not.toContain('autosaveDesign')
    expect(lifecycleSource).toContain('startAttachedDesignSession')
    expect(lifecycleSource).toContain('autosaveDesignSession')
    expect(lifecycleSource).toContain('teardownAttachedDesignSession')
    expect(lifecycleSource).not.toContain('transitionDocument')
    expect(lifecycleSource).not.toContain('buildPersistedDesignSessionContent')
    expect(lifecycleSource).not.toContain('../../ipc/design')
    expect(transitionSource).toContain('createDesignSessionStateMachine')
    expect(stateMachineSource).toContain('transitionDocument')
    expect(stateMachineSource).toContain('buildPersistedDesignSessionContent')
    expect(stateMachineSource).toContain('autosaveDesign')
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

  it('keeps Timeline Action workbench and drag edits behind app/timeline modules', () => {
    const timelineSource = readSource('../components/canvas/InteractiveTimeline.tsx')
    const canvasWorkbenchSource = readSource('../app/timeline/canvas-workbench.ts')
    const interactionSource = readSource('../app/timeline/interaction.ts')
    const editingSource = readSource('../app/timeline/editing.ts')
    const workbenchSource = readSource('../app/timeline/workbench.ts')

    expect(timelineSource).not.toContain('beginDocumentArrayEdit')
    expect(timelineSource).not.toContain('beginTimelineActionEdit')
    expect(timelineSource).not.toContain('computeTimelineAutoScrollSpeed')
    expect(timelineSource).not.toContain('applyTimelineActionPatch')
    expect(timelineSource).not.toContain('../app/timeline/controller')
    expect(timelineSource).not.toContain('createTimelineActionFromFormData')
    expect(timelineSource).not.toContain('formDataFromTimelineAction')
    expect(timelineSource).not.toContain('timelineActionPatchFromFormData')
    expect(timelineSource).toContain('../app/timeline/canvas-workbench')
    expect(canvasWorkbenchSource).toContain('./interaction')
    expect(canvasWorkbenchSource).toContain('./workbench')
    expect(canvasWorkbenchSource).toContain('hitTestAction')
    expect(interactionSource).toContain('beginTimelineActionEdit')
    expect(interactionSource).toContain('computeTimelineAutoScrollSpeed')
    expect(editingSource).toContain('beginDocumentArrayEdit')
    expect(editingSource).toContain('applyTimelineActionPatch')
    expect(workbenchSource).toContain('../planning-projection')
    expect(workbenchSource).toContain('./controller')
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
    expect(workbenchSource).toContain('hitTestBar')
    expect(interactionSource).toContain('beginDocumentArrayEdit')
    expect(interactionSource).toContain('moveConsortiumEntryInArray')
    expect(interactionSource).toContain('reorderConsortiumEntryInArray')
  })
})
