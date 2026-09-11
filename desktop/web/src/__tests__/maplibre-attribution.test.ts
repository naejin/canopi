import { afterEach, expect, it, vi } from 'vitest'
import type { Map } from 'maplibre-gl'

afterEach(() => vi.unstubAllGlobals())

it('removes consecutive event attributes from map attribution while preserving its source link', async () => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL() { return 'blob:map-worker' }
  })
  const { AttributionControl } = await import('maplibre-gl')
  const control = new AttributionControl({ compact: false,
    customAttribution: '<details open onload="void 0" ontoggle="void 0"><a href="https://example.com/source">Map source</a></details>',
  })
  // The control needs map lifecycle and sizing, but no WebGL renderer.
  const map = {
    style: { stylesheet: {}, tileManagers: {} },
    _getUIString: (key: string) => key,
    getCanvasContainer: () => document.createElement('div'),
    on: vi.fn(), off: vi.fn(),
  } as unknown as Map
  const container = control.onAdd(map)
  try {
    expect(container.querySelector('[onload], [ontoggle]')).toBeNull()
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/source')
    expect(container.textContent).toContain('Map source')
  } finally {
    control.onRemove()
  }
})
