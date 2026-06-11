import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../ipc/species', () => ({
  getSpeciesBatch: vi.fn(async () => []),
  getFlowerColorBatch: vi.fn(async () => []),
  getCommonNames: vi.fn(async () => ({})),
}))

import type { CanopiFile } from '../../../types/design'
import { SceneStore } from '../scene'
import { SceneRuntimePresentationController } from './presentation'
import { getCommonNames, getFlowerColorBatch, getSpeciesBatch } from '../../../ipc/species'

function makeFile(): CanopiFile {
  return {
    version: 1,
    name: 'Presentation demo',
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: {},
    layers: [
      { name: 'plants', visible: true, locked: false, opacity: 1 },
      { name: 'zones', visible: true, locked: false, opacity: 1 },
      { name: 'annotations', visible: true, locked: false, opacity: 1 },
    ],
    plants: [
      {
        id: 'plant-1',
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: null,
        position: { x: 10, y: 10 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      },
    ],
    zones: [
      {
        name: 'zone-1',
        zone_type: 'rect',
        rotation: 0,
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        fill_color: null,
        notes: null,
        locked: false,
      },
    ],
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

function createController() {
  const sceneStore = new SceneStore(makeFile())
  const state = {
    locale: 'fr',
    viewport: { x: 0, y: 0, scale: 2 },
    namesChanged: 0,
  }
  const controller = new SceneRuntimePresentationController({
    sceneStore,
    getViewport: () => state.viewport,
    getLocale: () => state.locale,
    resolveHighlightedTargets: () => ({
      plantIds: ['plant-1'],
      zoneIds: ['zone-1'],
    }),
    onPlantNamesChanged: () => {
      state.namesChanged += 1
    },
  })
  return { controller, sceneStore, state }
}

describe('scene runtime presentation controller', () => {
  beforeEach(() => {
    vi.mocked(getCommonNames).mockReset()
    vi.mocked(getSpeciesBatch).mockReset()
    vi.mocked(getFlowerColorBatch).mockReset()
    vi.mocked(getCommonNames).mockResolvedValue({})
    vi.mocked(getSpeciesBatch).mockResolvedValue([])
    vi.mocked(getFlowerColorBatch).mockResolvedValue([])
  })

  it('hydrates labels and backfills plant presentation metadata', async () => {
    vi.mocked(getCommonNames).mockResolvedValue({
      'Malus domestica': 'Pommier',
    })
    vi.mocked(getSpeciesBatch).mockResolvedValue([{
      canonical_name: 'Malus domestica',
      locked: false,
      stratum: 'canopy',
      width_max_m: 4.5,
    } as never])
    vi.mocked(getFlowerColorBatch).mockResolvedValue([{
      canonical_name: 'Malus domestica',
      locked: false,
      flower_color: 'white',
      source: 'detail',
    } as never])

    const { controller, sceneStore, state } = createController()

    const result = await controller.refreshCurrentPresentationData()
    if (result.backfills) {
      const byId = new Map(result.backfills.map((entry) => [entry.plantId, entry]))
      sceneStore.updatePersisted((draft) => {
        draft.plants = draft.plants.map((plant) => {
          const next = byId.get(plant.id)
          if (!next) return plant
          return {
            ...plant,
            stratum: next.stratum,
            canopySpreadM: next.canopySpreadM,
            scale: next.scale,
          }
        })
      })
    }

    expect(result.changed).toBe(true)
    expect(state.namesChanged).toBe(1)
    expect(controller.getLocalizedCommonNames().get('Malus domestica')).toBe('Pommier')
    expect(sceneStore.persisted.plants[0]).toMatchObject({
      stratum: 'canopy',
      canopySpreadM: 4.5,
      scale: 4.5,
    })
    expect(controller.getSpeciesCache().get('Malus domestica')).toMatchObject({
      resolved_flower_color: 'white',
      stratum: 'canopy',
      width_max_m: 4.5,
    })
  })

  it('builds renderer snapshots from scene, viewport, and highlighted targets', async () => {
    vi.mocked(getCommonNames).mockResolvedValue({
      'Malus domestica': 'Pommier',
    })
    const { controller, sceneStore } = createController()
    sceneStore.setSelection(['plant-1'])
    sceneStore.updateSession((session) => {
      session.hoveredEntityId = 'plant-1'
      session.plantSizeMode = 'canopy'
      session.plantColorByAttr = 'flower'
    })

    await controller.refreshSpeciesCacheEntries(['Malus domestica'], 'fr')
    const snapshot = controller.buildRendererSnapshot()

    expect(snapshot.viewport.scale).toBe(2)
    expect(snapshot.selectedPlantIds).toEqual(new Set(['plant-1']))
    expect(snapshot.highlightedPlantIds).toEqual(new Set(['plant-1']))
    expect(snapshot.highlightedZoneIds).toEqual(new Set(['zone-1']))
    expect(snapshot.hoveredCanonicalName).toBe('Malus domestica')
    expect(snapshot.localizedCommonNames.get('Malus domestica')).toBe('Pommier')
    expect(snapshot.sizeMode).toBe('canopy')
    expect(snapshot.colorByAttr).toBe('flower')
  })

  it('marks hovered targets with locked hover reasons for renderer cues', () => {
    const { controller, sceneStore } = createController()
    sceneStore.updateSession((session) => {
      session.hoveredEntityId = 'zone-1'
    })
    sceneStore.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'zones' ? { ...layer, locked: true } : layer
      ))
    })

    expect(controller.buildRendererSnapshot().hoverTarget).toEqual({
      kind: 'zone',
      id: 'zone-1',
      state: 'locked-layer',
    })

    sceneStore.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'zones' ? { ...layer, locked: false } : layer
      ))
      draft.zones = draft.zones.map((zone) => (
        zone.name === 'zone-1' ? { ...zone, locked: true } : zone
      ))
    })

    expect(controller.buildRendererSnapshot().hoverTarget).toEqual({
      kind: 'zone',
      id: 'zone-1',
      state: 'locked-design-object',
    })
  })

  it('treats label-only refreshes as presentation changes', async () => {
    vi.mocked(getCommonNames).mockResolvedValue({
      'Malus domestica': 'Pommier',
    })

    const { controller, sceneStore } = createController()
    sceneStore.updateSession((session) => {
      session.plantSizeMode = 'default'
      session.plantColorByAttr = null
    })

    const result = await controller.refreshSpeciesCacheEntries(['Malus domestica'], 'fr')

    expect(result.changed).toBe(true)
    expect(controller.getLocalizedCommonNames().get('Malus domestica')).toBe('Pommier')
  })
})
