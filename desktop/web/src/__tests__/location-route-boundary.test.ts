import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('location route boundary', () => {
  it('keeps the canvas shell free of direct location-tab imports', () => {
    expect(readSource('../components/panels/CanvasPanel.tsx')).not.toContain('LocationTab')
    expect(readSource('../components/canvas/BottomPanel.tsx')).not.toContain("import('./LocationTab')")
  })

  it('loads the location flow through the dedicated location panel', () => {
    const appSource = readSource('../app.tsx')
    const panelSource = readSource('../components/panels/LocationPanel.tsx')

    expect(appSource).toContain('import("./components/panels/LocationPanel")')
    expect(panelSource).toContain("LocationTab")
  })
})
