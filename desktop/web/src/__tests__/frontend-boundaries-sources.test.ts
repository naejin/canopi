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
    expect(presentationSource).toContain('createPanelTargetPresentationController')
  })

  it('keeps scene layer and guide writes behind the Scene Edit runtime seam', () => {
    const controllerSource = readSource('../app/canvas-settings/controller.ts')
    const runtimeSource = readSource('../canvas/runtime/scene-runtime.ts')
    const effectsSource = readSource('../canvas/runtime/scene-runtime/effects.ts')
    const documentSource = readSource('../canvas/runtime/scene-runtime/document.ts')

    expect(controllerSource).toContain('getCurrentCanvasCommandSurface')
    expect(controllerSource).not.toContain('layerVisibility.value =')
    expect(controllerSource).not.toContain('layerLockState.value =')
    expect(controllerSource).not.toContain('layerOpacity.value =')
    expect(runtimeSource).toContain('setSceneLayerVisibility')
    expect(runtimeSource).toContain("_sceneEdits.begin('guide-add')")
    expect(runtimeSource).not.toContain('applySignalBackedSceneState')
    expect(effectsSource).not.toContain('layerVisibility')
    expect(effectsSource).not.toContain('guides')
    expect(documentSource).not.toContain('applySignalBackedSceneState')
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
    const workflowsSource = readSource('../app/document-session/workflows.ts')
    const mapSurfaceSource = readSource('../components/canvas/maplibre-surface-controller.ts')

    expect(runtimeSurfaceSource).toContain('CanvasQueryRevision')
    expect(mountedRuntimeSource).toContain('_incrementSceneRevision')
    expect(documentBridgeSource).toContain('incrementSceneRevision')
    expect(documentBridgeSource).not.toContain('sceneEntityRevision')
    expect(workflowsSource).toContain('revision.scene.value')
    expect(mapSurfaceSource).toContain('revision.viewport.value')
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
    expect(actionsSource).not.toContain('transitionDocument')
    expect(transitionSource).toContain('createDesignSessionStateMachine')
    expect(stateMachineSource).toContain('transitionDocument')
    expect(stateMachineSource).toContain('buildPersistedDesignSessionContent')
    expect(stateMachineSource).toContain('autosaveDesign')
  })

  it('keeps the Problem Report dialog behind the submission module', () => {
    const dialogSource = readSource('../components/shared/ProblemReportDialog.tsx')

    expect(dialogSource).toContain('problemReportSubmission')
    expect(dialogSource).not.toContain('recentFrontendDiagnostics')
    expect(dialogSource).not.toContain('buildCurrentDesignProblemReportAttachment')
    expect(dialogSource).not.toContain('../../ipc/problem-report')
    expect(dialogSource).not.toContain('ProblemReportRequest')
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

  it('keeps Timeline Action Canvas behavior behind one app/timeline/canvas module seam', () => {
    const timelineSource = readSource('../components/canvas/InteractiveTimeline.tsx')
    const canvasIndexSource = readSource('../app/timeline/canvas/index.ts')
    const canvasHostSource = readSource('../app/timeline/canvas/host-model.ts')
    const canvasControllerSource = readSource('../app/timeline/canvas/controller.ts')
    const interactionFrameSource = readSource('../app/timeline/canvas/interaction-frame.ts')
    const interactionSource = readSource('../app/timeline/interaction.ts')
    const editingSource = readSource('../app/timeline/editing.ts')
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
    expect(canvasControllerSource).toContain('./interaction-frame')
    expect(canvasControllerSource).toContain('createTimelineActionInteractionFrame')
    expect(canvasControllerSource).toContain('view:')
    expect(canvasControllerSource).toContain('popover:')
    expect(canvasControllerSource).toContain('selection:')
    expect(canvasControllerSource).toContain('hover:')
    expect(interactionFrameSource).toContain('hitTestAction')
    expect(interactionFrameSource).toContain('createTimelineMoveDrag')
    expect(interactionFrameSource).toContain('createTimelineResizeDrag')
    expect(interactionFrameSource).toContain('timelineAutoScrollSpeed')
    expect(interactionFrameSource).toContain('restoreTimelineOriginScroll')
    expect(interactionFrameSource).toContain('setTimelineHoveredPanelTargets')
    expect(interactionFrameSource).toContain('setTimelineSelectedPanelTargets')
    expect(interactionFrameSource).toContain('deleteSelectedTimelineAction')
    expect(interactionFrameSource).toContain('saveTimelineActionPopover')
    expect(interactionFrameSource).toContain('deleteTimelineActionPopover')
    expect(interactionFrameSource).toContain('openTimelineActionPopover')
    expect(interactionFrameSource).toContain('isEditableTarget')
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
