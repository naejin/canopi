import { afterEach, describe, expect, it, vi } from 'vitest'
import { setCurrentCanvasSession } from '../canvas/session'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'
import { locale } from '../app/settings/state'
import type { CanopiFile } from '../types/design'
import {
  buildDesignReportInput,
  exportCurrentDesignReportPdf,
} from '../app/design-report/actions'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { createTestCanvasDocumentSurface, createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'
import {
  canvasClean,
  currentDesign,
  designDirty,
  nonCanvasRevision,
  nonCanvasSavedRevision,
  replaceCurrentDesignState,
} from './support/design-session-state'
import * as reportIpc from '../ipc/design-report'

vi.mock('../ipc/design-report', () => ({
  exportDesignReportPdf: vi.fn(async () => '/tmp/report.pdf'),
}))

const BASE_DESIGN: CanopiFile = {
  version: 2,
  name: 'Report design',
  description: null,
  location: null,
  north_bearing_deg: null,
  plant_species_colors: {},
  layers: [],
  plants: [],
  zones: [],
  annotations: [],
  consortiums: [],
  groups: [],
  timeline: [],
  budget: [],
  budget_currency: 'EUR',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  extra: {},
}

function reportPlant(id: string, canonicalName: string, commonName: string, x = 0): CanopiFile['plants'][number] {
  return {
    id,
    canonical_name: canonicalName,
    common_name: commonName,
    color: null,
    position: { x, y: 0 },
    rotation: null,
    scale: null,
    notes: null,
    planted_date: null,
    quantity: 1,
    locked: false,
  }
}

describe('Design Report export input', () => {
  afterEach(() => {
    vi.clearAllMocks()
    setCurrentCanvasSession(null)
    currentDesign.value = null
    nonCanvasRevision.value = 0
    nonCanvasSavedRevision.value = 0
    canvasClean.value = true
    locale.value = 'en'
  })

  it('omits empty metadata and fits the canvas page to visible layers', () => {
    const input = buildDesignReportInput({
      ...BASE_DESIGN,
      description: '   ',
      layers: [
        { name: 'plants', visible: true, locked: false, opacity: 1 },
        { name: 'zones', visible: false, locked: false, opacity: 1 },
      ],
      plants: [
        {
          id: 'plant-1',
          canonical_name: 'Malus domestica',
          common_name: 'Apple',
          color: '#AA0000',
          position: { x: 0, y: 0 },
          rotation: null,
          scale: null,
          notes: null,
          planted_date: null,
          quantity: 1,
          locked: false,
        },
        {
          id: 'plant-2',
          canonical_name: 'Pyrus communis',
          common_name: 'Pear',
          color: '#00AA00',
          position: { x: 160, y: 40 },
          rotation: null,
          scale: null,
          notes: null,
          planted_date: null,
          quantity: 1,
          locked: false,
        },
      ],
      zones: [{
        name: 'hidden-zone',
        zone_type: 'polygon',
        points: [{ x: 0, y: 0 }, { x: 0, y: 400 }, { x: 20, y: 400 }],
        rotation: 0,
        fill_color: null,
        notes: null,
        locked: false,
      }],
    })

    expect(input.metadata).toEqual({})
    expect(input.canvas.page.background).toBe('#FFFFFF')
    expect(input.canvas.page.orientation).toBe('landscape')
    expect(input.canvas.visible_layer_names).toEqual(['plants'])
    expect(input.canvas.plants.map((plant) => plant.id)).toEqual(['plant-1', 'plant-2'])
    expect(input.canvas.zones).toEqual([])
    expect(input.canvas.bounds).toEqual({ min_x: 0, min_y: 0, max_x: 160, max_y: 40 })
  })

  it('exports current serialized Design Session state without clearing dirty state', async () => {
    replaceCurrentDesignState(
      {
        ...BASE_DESIGN,
        name: 'Saved snapshot',
        plants: [],
      },
      null,
      'Saved snapshot',
    )
    nonCanvasRevision.value = 1
    nonCanvasSavedRevision.value = 0
    canvasClean.value = false
    const livePlant = {
      id: 'live-plant',
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      color: null,
      position: { x: 12, y: 8 },
      rotation: null,
      scale: null,
      notes: null,
      planted_date: null,
      quantity: 1,
      locked: false,
    }
    const serializeDocument = vi.fn((metadata: { name: string }, doc: CanopiFile): CanopiFile => ({
      ...doc,
      name: metadata.name,
      plants: [livePlant],
    }))
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      documents: createTestCanvasDocumentSurface({ serializeDocument }),
    }))

    await exportCurrentDesignReportPdf()

    expect(serializeDocument).toHaveBeenCalledTimes(1)
    expect(reportIpc.exportDesignReportPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Saved snapshot',
        canvas: expect.objectContaining({
          plants: [expect.objectContaining({ id: 'live-plant' })],
        }),
      }),
      'Saved snapshot Design Report.pdf',
    )
    expect(designDirty.value).toBe(true)
    expect(nonCanvasRevision.value).toBe(1)
    expect(canvasClean.value).toBe(false)
  })

  it('snapshots visible pinned plant names, measurement guides and pinned legend from the live canvas presentation', async () => {
    const serializedPlant = {
      id: 'plant-1',
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      color: '#112233',
      symbol: 'tree',
      pinned_name: true,
      position: { x: 10, y: 20 },
      rotation: null,
      scale: null,
      notes: null,
      planted_date: null,
      quantity: 1,
      locked: false,
    }
    const serializedDesign: CanopiFile = {
      ...BASE_DESIGN,
      name: 'Pinned guide report',
      layers: [
        { name: 'plants', visible: true, locked: false, opacity: 1 },
        { name: 'measurement-guides', visible: true, locked: false, opacity: 1 },
      ],
      plants: [serializedPlant],
      measurement_guides: [{
        id: 'guide-1',
        locked: false,
        start: { x: 10, y: 20 },
        end: { x: 13, y: 24 },
      }],
    }
    const scene = createDefaultScenePersistedState()
    scene.layers = serializedDesign.layers.map((layer) => ({ kind: 'layer', ...layer }))
    scene.plants = [{
      kind: 'plant',
      id: serializedPlant.id,
      locked: false,
      canonicalName: serializedPlant.canonical_name,
      commonName: serializedPlant.common_name,
      color: serializedPlant.color,
      symbol: serializedPlant.symbol,
      pinnedName: true,
      stratum: null,
      canopySpreadM: null,
      position: serializedPlant.position,
      rotationDeg: null,
      scale: null,
      notes: null,
      plantedDate: null,
      quantity: 1,
    }]
    const query = createTestCanvasQuerySurface({
      scene,
      localizedNames: new Map([['Malus domestica', 'Pommier']]),
    })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: query,
      documents: createTestCanvasDocumentSurface({
        serializeDocument: () => serializedDesign,
      }),
    }))
    replaceCurrentDesignState(serializedDesign, null, serializedDesign.name)

    await exportCurrentDesignReportPdf()

    expect(reportIpc.exportDesignReportPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas: expect.objectContaining({
          plants: [expect.objectContaining({
            id: 'plant-1',
            pinned_name_label: 'Pommier',
          })],
          measurement_guides: [{
            id: 'guide-1',
            start: { x: 10, y: 20 },
            end: { x: 13, y: 24 },
            label: '5 m',
          }],
          legend: {
            kind: 'pinned-plant-names',
            title: 'Legend',
            entries: [{
              label: 'Pommier',
              color: '#112233',
              symbol: 'tree',
              count: 1,
            }],
          },
        }),
      }),
      'Pinned guide report Design Report.pdf',
    )
    const [exportedInput] = vi.mocked(reportIpc.exportDesignReportPdf).mock.calls[0]!
    query.setLocalizedNames(new Map([['Malus domestica', 'Apple']]))
    expect(exportedInput.canvas.plants[0]?.pinned_name_label).toBe('Pommier')
    expect(exportedInput.canvas.legend).toEqual(expect.objectContaining({
      entries: [expect.objectContaining({ label: 'Pommier' })],
    }))
  })

  it('omits pinned labels, measurement guides and pinned legend when their layers are hidden', () => {
    const scene = createDefaultScenePersistedState()
    scene.plants = [{
      kind: 'plant',
      id: 'live-plant',
      locked: false,
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: '#112233',
      symbol: 'tree',
      pinnedName: true,
      stratum: null,
      canopySpreadM: null,
      position: { x: 10, y: 20 },
      rotationDeg: null,
      scale: null,
      notes: null,
      plantedDate: null,
      quantity: 1,
    }]

    const input = buildDesignReportInput({
      ...BASE_DESIGN,
      layers: [
        { name: 'plants', visible: false, locked: false, opacity: 1 },
        { name: 'measurement-guides', visible: false, locked: false, opacity: 1 },
      ],
      plants: [{
        id: 'plant-1',
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: '#112233',
        symbol: 'tree',
        pinned_name: true,
        position: { x: 10, y: 20 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      }],
      measurement_guides: [{
        id: 'guide-1',
        locked: false,
        start: { x: 10, y: 20 },
        end: { x: 13, y: 24 },
      }],
    }, {
      querySurface: createTestCanvasQuerySurface({
        scene,
        localizedNames: new Map([['Malus domestica', 'Pommier']]),
      }),
    })

    expect(input.canvas.plants).toEqual([])
    expect(input.canvas.measurement_guides).toEqual([])
    expect(input.canvas.legend).toBeNull()
  })

  it('uses the color-by legend instead of the pinned-name legend when color by is active', () => {
    const input = buildDesignReportInput({
      ...BASE_DESIGN,
      layers: [{ name: 'plants', visible: true, locked: false, opacity: 1 }],
      plants: [{
        id: 'plant-1',
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: '#112233',
        symbol: 'tree',
        pinned_name: true,
        position: { x: 10, y: 20 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      }],
    }, {
      querySurface: createTestCanvasQuerySurface({
        plantColorByAttr: 'flower',
        localizedNames: new Map([['Malus domestica', 'Pommier']]),
      }),
    })

    expect(input.canvas.legend?.kind).toBe('color-by')
    expect(input.canvas.legend).toEqual(expect.objectContaining({
      kind: 'color-by',
      title: 'Legend',
      attribute: 'flower',
      entries: expect.arrayContaining([
        expect.objectContaining({ label: 'White' }),
      ]),
    }))
    expect(input.canvas.legend).not.toEqual(expect.objectContaining({
      kind: 'pinned-plant-names',
    }))
  })

  it('omits empty timelines and snapshots localized timeline rows when actions exist', () => {
    locale.value = 'fr'

    expect(buildDesignReportInput(BASE_DESIGN).timeline).toBeNull()

    const input = buildDesignReportInput({
      ...BASE_DESIGN,
      plants: [{
        id: 'plant-1',
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: null,
        position: { x: 0, y: 0 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      }],
      zones: [{
        name: 'North bed',
        zone_type: 'bed',
        points: [],
        rotation: 0,
        fill_color: null,
        notes: null,
        locked: false,
      }],
      timeline: [
        {
          id: 'mulch',
          action_type: 'other',
          description: 'Add mulch before first heat wave',
          start_date: null,
          end_date: null,
          recurrence: null,
          targets: [{ kind: 'zone', zone_name: 'North bed' }],
          depends_on: null,
          completed: false,
          order: 2,
        },
        {
          id: 'plant',
          action_type: 'planting',
          description: 'Plant apple guild and water deeply',
          start_date: '2026-03-01',
          end_date: '2026-03-10',
          recurrence: 'yearly',
          targets: [{ kind: 'species', canonical_name: 'Malus domestica' }],
          depends_on: ['mulch'],
          completed: true,
          order: 1,
        },
      ],
    }, {
      querySurface: createTestCanvasQuerySurface({
        localizedNames: new Map([['Malus domestica', 'Pommier']]),
      }),
    })

    expect(input.timeline).toEqual(expect.objectContaining({
      title: 'Calendrier',
      overview_title: 'Vue d’ensemble',
      table_title: 'Actions',
      columns: expect.objectContaining({
        action_type: "Type d'action",
        recurrence: 'Récurrence',
        dependencies: 'Dépendances',
      }),
      overview_rows: expect.arrayContaining([
        expect.objectContaining({
          action_type: 'planting',
          label: 'Plantation',
          count: 1,
          date_range: expect.stringContaining('mars'),
        }),
      ]),
      actions: [
        expect.objectContaining({
          id: 'plant',
          action_type_label: 'Plantation',
          description: 'Plant apple guild and water deeply',
          start_date: expect.stringContaining('mars'),
          end_date: expect.stringContaining('mars'),
          recurrence: 'yearly',
          target: 'Pommier',
          dependencies: 'mulch',
          status: 'Terminé',
        }),
        expect.objectContaining({
          id: 'mulch',
          action_type_label: 'Autre',
          start_date: 'Non planifié',
          end_date: 'Non planifié',
          target: 'North bed',
          dependencies: 'Aucune',
          status: 'Ouvert',
        }),
      ],
    }))
  })

  it('omits derived empty budget rows and snapshots user-entered budget totals with locale formatting', () => {
    locale.value = 'fr'

    expect(buildDesignReportInput({
      ...BASE_DESIGN,
      plants: [{
        id: 'plant-1',
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: null,
        position: { x: 0, y: 0 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: 1,
        locked: false,
      }],
    }).budget).toBeNull()

    const input = buildDesignReportInput({
      ...BASE_DESIGN,
      budget_currency: 'EUR',
      plants: [
        {
          id: 'plant-1',
          canonical_name: 'Malus domestica',
          common_name: 'Apple',
          color: null,
          position: { x: 0, y: 0 },
          rotation: null,
          scale: null,
          notes: null,
          planted_date: null,
          quantity: 1,
          locked: false,
        },
        {
          id: 'plant-2',
          canonical_name: 'Malus domestica',
          common_name: 'Apple',
          color: null,
          position: { x: 1, y: 1 },
          rotation: null,
          scale: null,
          notes: null,
          planted_date: null,
          quantity: 1,
          locked: false,
        },
      ],
      budget: [
        {
          target: { kind: 'species', canonical_name: 'Malus domestica' },
          category: 'plants',
          description: 'Bare-root apple tree with a deliberately long description',
          quantity: 0,
          unit_cost: 7.5,
          currency: 'EUR',
        },
        {
          target: { kind: 'manual' },
          category: 'materials',
          description: 'Compost delivery',
          quantity: 2.5,
          unit_cost: 12,
          currency: 'EUR',
        },
      ],
    }, {
      querySurface: createTestCanvasQuerySurface({
        localizedNames: new Map([['Malus domestica', 'Pommier']]),
      }),
    })

    expect(input.budget).toEqual(expect.objectContaining({
      title: 'Budget',
      columns: expect.objectContaining({
        target: 'Cible',
        quantity: 'Qté',
        line_total: 'Total',
      }),
      rows: [
        expect.objectContaining({
          target: 'Pommier',
          category: 'plants',
          description: 'Bare-root apple tree with a deliberately long description',
          quantity: '2',
          unit_cost: expect.stringContaining('€'),
          line_total: expect.stringContaining('15'),
          currency: 'EUR',
        }),
        expect.objectContaining({
          target: 'Manuel',
          category: 'materials',
          description: 'Compost delivery',
          quantity: '2,5',
          unit_cost: expect.stringContaining('€'),
          line_total: expect.stringContaining('30'),
          currency: 'EUR',
        }),
      ],
      totals: [expect.objectContaining({
        currency: 'EUR',
        amount: expect.stringContaining('45'),
      })],
    }))
  })

  it('omits untouched default consortiums and snapshots complete localized changed consortiums', () => {
    locale.value = 'fr'
    const plants = [
      reportPlant('apple-1', 'Malus domestica', 'Apple'),
      reportPlant('apple-2', 'Malus domestica', 'Apple', 1),
      reportPlant('pear-1', 'Pyrus communis', 'Pear', 2),
    ]
    const defaultConsortiums: CanopiFile['consortiums'] = [
      {
        target: { kind: 'species', canonical_name: 'Malus domestica' },
        stratum: 'unassigned',
        start_phase: 0,
        end_phase: 2,
      },
      {
        target: { kind: 'species', canonical_name: 'Pyrus communis' },
        stratum: 'unassigned',
        start_phase: 0,
        end_phase: 2,
      },
    ]

    expect(buildDesignReportInput({
      ...BASE_DESIGN,
      plants,
      consortiums: defaultConsortiums,
    }).consortium).toBeNull()

    const input = buildDesignReportInput({
      ...BASE_DESIGN,
      plant_species_colors: {
        'Malus domestica': '#AA0000',
        'Pyrus communis': '#00AA00',
      },
      plants,
      consortiums: [
        ...defaultConsortiums.slice(0, 1),
        {
          target: { kind: 'species', canonical_name: 'Pyrus communis' },
          stratum: 'high',
          start_phase: 1,
          end_phase: 4,
        },
        {
          target: { kind: 'species', canonical_name: 'Prunus avium' },
          stratum: 'low',
          start_phase: 3,
          end_phase: 6,
        },
      ],
    }, {
      querySurface: createTestCanvasQuerySurface({
        localizedNames: new Map([
          ['Malus domestica', 'Pommier'],
          ['Pyrus communis', 'Poirier'],
          ['Prunus avium', 'Cerisier'],
        ]),
      }),
    })

    expect(input.consortium).toEqual(expect.objectContaining({
      title: 'Consortium',
      chart_title: 'Diagramme de succession',
      table_title: 'Entrées du consortium',
      phases: expect.arrayContaining(['Placenta 1', 'Secondaire 2']),
      columns: expect.objectContaining({
        plant: 'Plante',
        canonical_name: 'Nom canonique',
        stratum: 'Strate',
        start_phase: 'Phase de début',
        end_phase: 'Phase de fin',
        count: 'Nombre',
      }),
      chart_rows: expect.arrayContaining([
        expect.objectContaining({
          stratum: 'Haut',
          cells: expect.arrayContaining([
            expect.objectContaining({
              entries: [expect.objectContaining({ label: 'Poirier', color: '#00AA00' })],
            }),
          ]),
        }),
        expect.objectContaining({
          stratum: 'Non assigné',
          cells: expect.arrayContaining([
            expect.objectContaining({
              entries: [expect.objectContaining({ label: 'Pommier', color: '#AA0000' })],
            }),
          ]),
        }),
      ]),
      rows: [
        expect.objectContaining({
          plant: 'Poirier',
          canonical_name: 'Pyrus communis',
          stratum: 'Haut',
          start_phase: 'Placenta 2',
          end_phase: 'Secondaire 2',
          count: '1',
        }),
        expect.objectContaining({
          plant: 'Pommier',
          canonical_name: 'Malus domestica',
          stratum: 'Non assigné',
          start_phase: 'Placenta 1',
          end_phase: 'Placenta 3',
          count: '2',
        }),
      ],
    }))
    expect(input.consortium?.rows).toHaveLength(2)
  })
})
