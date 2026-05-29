import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
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

  it('keeps scene runtime panel-target app signals behind an injected adapter', () => {
    const runtimeSource = readSource('../canvas/runtime/scene-runtime.ts')
    const effectsSource = readSource('../canvas/runtime/scene-runtime/effects.ts')
    const adapterSource = readSource('../app/canvas-runtime/panel-target-adapter.ts')
    const presentationSource = readSource('../app/panel-targets/presentation.ts')

    expect(runtimeSource).not.toContain('app/panel-targets')
    expect(effectsSource).not.toContain('app/panel-targets')
    expect(adapterSource).toContain('../panel-targets/presentation')
    expect(adapterSource).not.toContain('../panel-targets/state')
    expect(presentationSource).toContain('./state')
  })

  it('keeps Planning Projection read models out of Canvas2D renderers', () => {
    const projectionSource = readSource('../app/planning-projection/consortium.ts')
    const rendererSource = readSource('../canvas/consortium-renderer.ts')

    expect(projectionSource).not.toContain('consortium-renderer')
    expect(rendererSource).not.toContain('buildConsortiumBars')
    expect(rendererSource).not.toContain('filterActiveConsortiumEntries')
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

  it('keeps Timeline Action document edits behind the Timeline editing module', () => {
    const timelineSource = readSource('../components/canvas/InteractiveTimeline.tsx')
    const interactionSource = readSource('../app/timeline/interaction.ts')
    const editingSource = readSource('../app/timeline/editing.ts')

    expect(timelineSource).not.toContain('beginDocumentArrayEdit')
    expect(timelineSource).not.toContain('beginTimelineActionEdit')
    expect(timelineSource).not.toContain('computeTimelineAutoScrollSpeed')
    expect(timelineSource).not.toContain('applyTimelineActionPatch')
    expect(interactionSource).toContain('beginTimelineActionEdit')
    expect(interactionSource).toContain('computeTimelineAutoScrollSpeed')
    expect(editingSource).toContain('beginDocumentArrayEdit')
    expect(editingSource).toContain('applyTimelineActionPatch')
  })

  it('keeps Consortium document drag edits behind the Consortium interaction module', () => {
    const consortiumSource = readSource('../components/canvas/ConsortiumChart.tsx')
    const interactionSource = readSource('../app/consortium/interaction.ts')

    expect(consortiumSource).not.toContain('beginDocumentArrayEdit')
    expect(consortiumSource).not.toContain('moveConsortiumEntryInArray')
    expect(consortiumSource).not.toContain('reorderConsortiumEntryInArray')
    expect(interactionSource).toContain('beginDocumentArrayEdit')
    expect(interactionSource).toContain('moveConsortiumEntryInArray')
    expect(interactionSource).toContain('reorderConsortiumEntryInArray')
  })
})
