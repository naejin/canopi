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
    const tabSource = readSource('../components/canvas/LocationTab.tsx')
    const inputSource = readSource('../components/canvas/LocationInput.tsx')

    expect(appSource).toContain('import("./components/panels/LocationPanel")')
    expect(panelSource).toContain("LocationTab")
    expect(tabSource).not.toContain("ipc/geocoding")
    expect(inputSource).not.toContain("ipc/geocoding")
  })

  it('keeps saved-location UI behind the Location Workbench seam', () => {
    const canvasPanelSource = readSource('../components/panels/CanvasPanel.tsx')
    const locationPanelSource = readSource('../components/panels/LocationPanel.tsx')
    const layerPanelSource = readSource('../components/canvas/LayerPanel.tsx')
    const compassOverlaySource = readSource('../components/canvas/CompassOverlay.tsx')
    const mapSurfaceControllerSource = readSource('../components/canvas/maplibre-surface-controller.ts')
    const tabSource = readSource('../components/canvas/LocationTab.tsx')
    const inputSource = readSource('../components/canvas/LocationInput.tsx')

    for (const source of [
      canvasPanelSource,
      locationPanelSource,
      layerPanelSource,
      compassOverlaySource,
      mapSurfaceControllerSource,
      tabSource,
      inputSource,
    ]) {
      expect(source).toContain('app/location')
      expect(source).not.toContain('document-session/store')
      expect(source).not.toContain('utils/location')
      expect(source).not.toContain('setDesignLocation')
      expect(source).not.toContain('clearDesignLocation')
      expect(source).not.toContain('createLocationSearchController')
    }
  })
})
