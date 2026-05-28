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

    expect(runtimeSource).not.toContain('app/panel-targets')
    expect(effectsSource).not.toContain('app/panel-targets')
    expect(adapterSource).toContain('../panel-targets/state')
  })

  it('keeps Planning Projection read models out of Canvas2D renderers', () => {
    const projectionSource = readSource('../app/planning-projection/consortium.ts')
    const rendererSource = readSource('../canvas/consortium-renderer.ts')

    expect(projectionSource).not.toContain('consortium-renderer')
    expect(rendererSource).not.toContain('buildConsortiumBars')
    expect(rendererSource).not.toContain('filterActiveConsortiumEntries')
  })
})
