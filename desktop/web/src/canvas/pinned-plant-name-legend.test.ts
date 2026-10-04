import { describe, expect, it, vi } from 'vitest'
import { geoAt } from '../__tests__/support/geo-design'
import { CURRENT_CANOPI_FILE_VERSION } from '../generated/canopi-design-format'
import type { CanopiFile } from '../types/design'
import { buildPinnedPlantNameLegendEntries } from './pinned-plant-name-legend'
import { getStratumColor } from './plants'
import { DEFAULT_PLANT_DISPLAY } from './runtime/plant-display'
import { resolvePlantDisplayColor } from './runtime/plant-presentation'
import type { SceneRendererSnapshot } from './runtime/renderers/scene-types'
import { createDetachedCanvasRuntimeAppAdapter } from './runtime/app-adapter'
import { SceneCanvasRuntime } from './runtime/scene-runtime'
import type { SpeciesCacheEntry } from './runtime/species-cache'

describe('pinned plant name legend through the runtime', () => {
  // A20: an opened Design's plants carry no stratum (the codec hydrates `stratum: null`) and the canvas colours them
  // from the species catalog. The runtime writes the catalog stratum into the Scene in the same publish that first
  // draws them and bumps the scene revision DisplayLegend reads, so the legend, which reads only the Scene, matches.
  it('shows an opened plant in the colour the canvas paints it once the species catalog loads', async () => {
    const speciesCache = new Map<string, SpeciesCacheEntry>()
    const renderer = { id: 'maplibre-pixi' as const, syncScene: vi.fn(), setView: vi.fn(), setDraft: vi.fn(), dispose: vi.fn() }
    const runtime = new SceneCanvasRuntime({
      renderer: { id: 'test', initialize: () => renderer },
      appAdapter: {
        ...createDetachedCanvasRuntimeAppAdapter(),
        presentationData: {
          speciesCache: {
            getCache: () => speciesCache,
            ensureEntries: async (canonicalNames) => {
              for (const name of canonicalNames) {
                speciesCache.set(name, { canonical_name: name, stratum: 'high', width_max_m: 4 } as SpeciesCacheEntry)
              }
              return true
            },
            getSuggestedPlantColor: () => null,
          },
          plantLabels: {
            getLocaleSnapshot: () => new Map(),
            getEnglishFallbackSnapshot: () => new Map(),
            ensureEntries: async () => false,
          },
        },
      },
    })
    runtime.documentSurface.loadDocument(openedDesignWithPinnedPlant())
    const legendColor = () => buildPinnedPlantNameLegendEntries(runtime.querySurface, DEFAULT_PLANT_DISPLAY)[0]?.color
    // Before the first frame neither the canvas nor the Scene has the catalog stratum.
    expect(runtime.querySurface.getSceneSnapshot().plants[0]?.stratum).toBeNull()
    expect(legendColor()).not.toBe(getStratumColor('high'))
    const sceneRevision = runtime.querySurface.revision.scene.value
    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })

    await runtime.init(host)
    await vi.waitFor(() => expect(renderer.syncScene).toHaveBeenCalled())

    const drawn = renderer.syncScene.mock.calls.at(-1)![0] as SceneRendererSnapshot
    const canvasColor = resolvePlantDisplayColor(drawn.scene.plants[0]!, drawn.speciesCache, DEFAULT_PLANT_DISPLAY)
    expect(canvasColor).toBe(getStratumColor('high'))
    expect(legendColor()).toBe(canvasColor)
    expect(runtime.querySurface.revision.scene.value).toBeGreaterThan(sceneRevision)
    runtime.destroy()
  })
})

/** A saved Design as the file holds it: the plant has no colour or stratum of its own. */
function openedDesignWithPinnedPlant(): CanopiFile {
  return {
    version: CURRENT_CANOPI_FILE_VERSION,
    name: 'Opened Design',
    description: null,
    plant_species_colors: {},
    layers: [{ name: 'plants', visible: true, locked: false, opacity: 1 }],
    plants: [{
      id: 'plant-1',
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      color: null,
      pinned_name: true,
      position: geoAt(10, 10, { lon: 0, lat: 0 }),
      rotation: null,
      scale: null,
      notes: null,
      planted_date: null,
      quantity: 1,
      locked: false,
    }],
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-04-02T00:00:00.000Z',
    updated_at: '2026-04-02T00:00:00.000Z',
    extra: {},
  }
}
