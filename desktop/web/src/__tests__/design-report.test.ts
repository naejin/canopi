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

const SUPPORTED_REPORT_LOCALES = ['en', 'fr', 'es', 'pt', 'it', 'zh', 'de', 'ja', 'ko', 'nl', 'ru'] as const

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

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectStrings)
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectStrings)
  }
  return []
}

function representativeDenseReportDesign(): CanopiFile {
  return {
    ...BASE_DESIGN,
    name: 'Dense multilingual report',
    description: 'Representative report with all printable sections',
    location: { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
    plant_species_colors: {
      'Malus domestica': '#AA0000',
      'Pyrus communis': '#00AA00',
      'Prunus avium': '#0000AA',
    },
    layers: [
      { name: 'plants', visible: true, locked: false, opacity: 1 },
      { name: 'zones', visible: true, locked: false, opacity: 1 },
      { name: 'annotations', visible: false, locked: false, opacity: 1 },
      { name: 'measurement-guides', visible: true, locked: false, opacity: 1 },
    ],
    plants: [
      { ...reportPlant('apple-uuid-1', 'Malus domestica', 'Apple'), color: '#AA0000', pinned_name: true },
      reportPlant('apple-uuid-2', 'Malus domestica', 'Apple', 2),
      reportPlant('pear-uuid-1', 'Pyrus communis', 'Pear', 4),
      reportPlant('cherry-uuid-1', 'Prunus avium', 'Cherry', 8),
    ],
    zones: [{
      name: 'North guild',
      zone_type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 18, y: 0 }, { x: 18, y: 12 }],
      rotation: 0,
      fill_color: '#D8C8A0',
      notes: null,
      locked: false,
    }],
    annotations: [{
      id: 'hidden-annotation-uuid',
      annotation_type: 'text',
      text: 'Hidden app chrome note',
      position: { x: 4, y: 4 },
      rotation: 0,
      font_size: 14,
      locked: false,
    }],
    measurement_guides: [{
      id: 'guide-uuid',
      locked: false,
      start: { x: 0, y: 0 },
      end: { x: 0, y: 8 },
    }],
    timeline: [
      {
        id: 'timeline-plant',
        action_type: 'planting',
        description: 'Plant dense guild',
        start_date: '2026-03-01',
        end_date: '2026-03-10',
        recurrence: null,
        targets: [{ kind: 'species', canonical_name: 'Malus domestica' }],
        depends_on: [],
        completed: false,
        order: 1,
      },
      {
        id: 'timeline-unscheduled',
        action_type: 'planting',
        description: '   ',
        start_date: null,
        end_date: null,
        recurrence: null,
        targets: [{ kind: 'zone', zone_name: 'North guild' }],
        depends_on: ['timeline-plant'],
        completed: false,
        order: 2,
      },
    ],
    budget_currency: 'USD',
    budget: [
      {
        target: { kind: 'manual' },
        category: 'tools',
        description: '   ',
        quantity: 0,
        unit_cost: 0,
        currency: 'USD',
      },
      {
        target: { kind: 'none' },
        category: 'materials',
        description: 'Mulch delivery',
        quantity: 0,
        unit_cost: 0,
        currency: 'EUR',
      },
    ],
    consortiums: [
      {
        target: { kind: 'species', canonical_name: 'Malus domestica' },
        stratum: 'high',
        start_phase: 0,
        end_phase: 2,
      },
      {
        target: { kind: 'species', canonical_name: 'Pyrus communis' },
        stratum: 'medium',
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
    expect(input.canvas.visible_layer_names).toEqual(['Plants'])
    expect(input.canvas.plants.map((plant) => plant.id)).toEqual(['plant-1', 'plant-2'])
    expect(input.canvas.zones).toEqual([])
    expect(input.canvas.bounds).toEqual({ min_x: 0, min_y: 0, max_x: 160, max_y: 40 })
  })

  it('snapshots localized document labels used by the PDF renderer', () => {
    locale.value = 'fr'

    const input = buildDesignReportInput({
      ...BASE_DESIGN,
      description: 'Plan imprimable',
      location: { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
    })

    expect(input.labels).toEqual({
      overview: 'Vue d’ensemble',
      location: 'Emplacement',
      altitude: 'altitude',
      design: 'Design',
      visible_layers: 'Calques visibles',
      default_visible_layers: 'par défaut',
      no_visible_canvas_objects: 'Aucun objet visible sur le canevas',
      pinned: 'Épinglé',
      color_by: 'Colorier par',
      page_number: 'Page {page} sur {count}',
    })
  })

  it('snapshots localized page number formats for supported report locales', () => {
    const cases = [
      ['en', 'Page {page} of {count}'],
      ['fr', 'Page {page} sur {count}'],
      ['es', 'Página {page} de {count}'],
      ['pt', 'Página {page} de {count}'],
      ['it', 'Pagina {page} di {count}'],
      ['zh', '第 {page} 页，共 {count} 页'],
      ['de', 'Seite {page} von {count}'],
      ['ja', '{count} ページ中 {page} ページ'],
      ['ko', '{count}페이지 중 {page}페이지'],
      ['nl', 'Pagina {page} van {count}'],
      ['ru', 'Страница {page} из {count}'],
    ] as const

    for (const [language, expected] of cases) {
      locale.value = language

      const input = buildDesignReportInput(BASE_DESIGN)

      expect(input.labels.page_number).toBe(expected)
    }
  })

  it('builds a representative dense report for every supported locale without missing localized text', () => {
    for (const language of SUPPORTED_REPORT_LOCALES) {
      locale.value = language
      const canvasImageRenderer = vi.fn(() => ({
        data_base64: 'white-png',
        width_px: 1200,
        height_px: 800,
      }))

      const input = buildDesignReportInput(representativeDenseReportDesign(), {
        querySurface: createTestCanvasQuerySurface({
          localizedNames: new Map([
            ['Malus domestica', 'Localized apple'],
            ['Pyrus communis', 'Localized pear'],
            ['Prunus avium', 'Localized cherry'],
          ]),
        }),
        canvasImageRenderer,
      })
      const allStrings = collectStrings(input)

      expect(input.metadata.description).toBeTruthy()
      expect(input.metadata.location).toEqual(expect.objectContaining({ lat: 48.8566, lon: 2.3522 }))
      expect(input.canvas.page.background).toBe('#FFFFFF')
      expect(input.canvas.image).toEqual(expect.objectContaining({ width_px: 1200, height_px: 800 }))
      expect(input.canvas.visible_layer_names.length).toBeGreaterThan(0)
      expect(input.canvas.annotations).toEqual([])
      expect(input.canvas.measurement_guides).toHaveLength(1)
      expect(input.canvas.legend).toEqual(expect.objectContaining({ kind: 'pinned-plant-names' }))
      expect(input.timeline?.overview_rows.length).toBeGreaterThan(0)
      expect(input.timeline?.actions.some((action) => action.description === '')).toBe(true)
      expect(input.budget?.rows).toHaveLength(2)
      expect(input.budget?.totals).toEqual(expect.arrayContaining([
        expect.objectContaining({ currency: 'USD' }),
        expect.objectContaining({ currency: 'EUR' }),
      ]))
      expect(input.consortium?.chart_rows.length).toBeGreaterThan(0)
      expect(input.consortium?.rows.length).toBeGreaterThan(0)
      expect(canvasImageRenderer).toHaveBeenCalledWith(expect.objectContaining({ background: '#FFFFFF' }))
      expect(allStrings).not.toContain('Hidden app chrome note')
      expect(allStrings.some((value) => /^(canvas|designReport)\./.test(value))).toBe(false)
      expect(allStrings.some((value) => value.includes('�') || value.includes('Ã'))).toBe(false)
    }
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

  it('requests a white-background canvas image from the visible scene presentation', () => {
    const scene = createDefaultScenePersistedState()
    scene.layers = [
      { kind: 'layer', name: 'zones', visible: true, locked: false, opacity: 1 },
      { kind: 'layer', name: 'plants', visible: true, locked: false, opacity: 1 },
      { kind: 'layer', name: 'annotations', visible: false, locked: false, opacity: 1 },
      { kind: 'layer', name: 'measurement-guides', visible: true, locked: false, opacity: 1 },
    ]
    scene.zones = [{
      kind: 'zone',
      name: 'North bed',
      locked: false,
      zoneType: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }],
      rotationDeg: 0,
      fillColor: '#C8D7B5',
      notes: null,
    }]
    scene.plants = Array.from({ length: 24 }, (_, index) => ({
      kind: 'plant' as const,
      id: `plant-${index + 1}`,
      locked: false,
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: '#112233',
      symbol: index % 2 === 0 ? 'tree' : 'shrub',
      pinnedName: index === 0,
      stratum: 'high',
      canopySpreadM: null,
      position: { x: index % 8 * 4, y: Math.floor(index / 8) * 4 },
      rotationDeg: null,
      scale: null,
      notes: null,
      plantedDate: null,
      quantity: 1,
    }))
    scene.annotations = [{
      kind: 'annotation',
      id: 'hidden-note',
      locked: false,
      annotationType: 'text',
      position: { x: 5, y: 5 },
      text: 'Hidden annotation',
      fontSize: 16,
      rotationDeg: 0,
    }]
    scene.measurementGuides = [{
      kind: 'measurement-guide',
      id: 'guide-1',
      locked: false,
      start: { x: 0, y: 0 },
      end: { x: 0, y: 12 },
    }]
    const canvasImageRenderer = vi.fn(() => ({
      data_base64: 'png-bytes',
      width_px: 1200,
      height_px: 800,
    }))

    const input = buildDesignReportInput({
      ...BASE_DESIGN,
      layers: scene.layers.map(({ name, visible, locked, opacity }) => ({ name, visible, locked, opacity })),
      plants: scene.plants.map((plant) => ({
        id: plant.id,
        canonical_name: plant.canonicalName,
        common_name: plant.commonName,
        color: plant.color,
        symbol: plant.symbol,
        pinned_name: plant.pinnedName,
        position: plant.position,
        rotation: plant.rotationDeg,
        scale: plant.scale,
        notes: plant.notes,
        planted_date: plant.plantedDate,
        quantity: plant.quantity,
        locked: plant.locked,
      })),
      zones: [{
        name: 'North bed',
        zone_type: 'polygon',
        points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }],
        rotation: 0,
        fill_color: '#C8D7B5',
        notes: null,
        locked: false,
      }],
      annotations: [{
        id: 'hidden-note',
        annotation_type: 'text',
        text: 'Hidden annotation',
        position: { x: 5, y: 5 },
        rotation: 0,
        font_size: 16,
        locked: false,
      }],
      measurement_guides: [{
        id: 'guide-1',
        locked: false,
        start: { x: 0, y: 0 },
        end: { x: 0, y: 12 },
      }],
    }, {
      querySurface: createTestCanvasQuerySurface({
        scene,
        localizedNames: new Map([['Malus domestica', 'Pommier']]),
      }),
      canvasImageRenderer,
    })

    expect(input.canvas.image).toEqual({
      data_base64: 'png-bytes',
      width_px: 1200,
      height_px: 800,
    })
    expect(canvasImageRenderer).toHaveBeenCalledWith(expect.objectContaining({
      background: '#FFFFFF',
      bounds: { min_x: 0, min_y: 0, max_x: 30, max_y: 20 },
      localizedNames: new Map([['Malus domestica', 'Pommier']]),
      page: expect.objectContaining({ background: '#FFFFFF', orientation: 'landscape' }),
      scene: expect.objectContaining({
        annotations: [expect.objectContaining({ text: 'Hidden annotation' })],
        measurementGuides: [expect.objectContaining({ id: 'guide-1' })],
        plants: expect.arrayContaining([expect.objectContaining({ pinnedName: true, symbol: 'tree' })]),
        zones: [expect.objectContaining({ fillColor: '#C8D7B5' })],
      }),
      sizeMode: 'default',
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
      attribute: 'Flower',
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
        start_date: 'Début',
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
          dependencies: '1 dépendance',
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

  it('summarizes mixed scheduled timeline groups without losing unscheduled actions', () => {
    locale.value = 'fr'

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
          id: 'plant',
          action_type: 'planting',
          description: 'Plant apple guild',
          start_date: '2026-03-01',
          end_date: '2026-03-10',
          recurrence: null,
          targets: [{ kind: 'species', canonical_name: 'Malus domestica' }],
          depends_on: [],
          completed: false,
          order: 1,
        },
        {
          id: 'inspect',
          action_type: 'planting',
          description: '   ',
          start_date: null,
          end_date: null,
          recurrence: null,
          targets: [
            { kind: 'species', canonical_name: 'Malus domestica' },
            { kind: 'zone', zone_name: 'North bed' },
            { kind: 'manual' },
          ],
          depends_on: ['', 'plant'],
          completed: false,
          order: 2,
        },
      ],
    }, {
      querySurface: createTestCanvasQuerySurface({
        localizedNames: new Map([['Malus domestica', 'Pommier']]),
      }),
    })

    expect(input.timeline?.overview_rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action_type: 'planting',
        count: 2,
        date_range: expect.stringMatching(/mars.*1 non planifiée/),
      }),
    ]))
    expect(input.timeline?.actions).toEqual([
      expect.objectContaining({
        id: 'plant',
        recurrence: 'Aucune',
        target: 'Pommier',
        dependencies: 'Aucune',
      }),
      expect.objectContaining({
        id: 'inspect',
        description: '',
        start_date: 'Non planifié',
        end_date: 'Non planifié',
        recurrence: 'Aucune',
        target: 'Pommier, North bed, Manuel',
        dependencies: '1 dépendance',
      }),
    ])
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
          category: 'Plantes',
          description: 'Bare-root apple tree with a deliberately long description',
          quantity: '2',
          unit_cost: expect.stringContaining('€'),
          line_total: expect.stringContaining('15'),
          currency: 'EUR',
        }),
        expect.objectContaining({
          target: 'Manuel',
          category: 'Matériaux',
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

  it('keeps zero-value budget rows intentional across multiple currencies', () => {
    locale.value = 'en'

    const input = buildDesignReportInput({
      ...BASE_DESIGN,
      budget_currency: 'USD',
      budget: [
        {
          target: { kind: 'manual' },
          category: 'tools',
          description: '   ',
          quantity: 0,
          unit_cost: 0,
          currency: 'USD',
        },
        {
          target: { kind: 'none' },
          category: 'materials',
          description: 'Imported mulch',
          quantity: 0,
          unit_cost: 0,
          currency: 'EUR',
        },
      ],
    })

    expect(input.budget).toEqual(expect.objectContaining({
      rows: [
        expect.objectContaining({
          target: 'Manual',
          category: 'Tools',
          description: '',
          quantity: '0',
          unit_cost: expect.stringContaining('$0.00'),
          line_total: expect.stringContaining('$0.00'),
          currency: 'USD',
        }),
        expect.objectContaining({
          target: 'None',
          category: 'Materials',
          description: 'Imported mulch',
          quantity: '0',
          unit_cost: expect.stringContaining('€0.00'),
          line_total: expect.stringContaining('€0.00'),
          currency: 'EUR',
        }),
      ],
      totals: expect.arrayContaining([
        expect.objectContaining({
          currency: 'USD',
          amount: expect.stringContaining('$0.00'),
        }),
        expect.objectContaining({
          currency: 'EUR',
          amount: expect.stringContaining('€0.00'),
        }),
      ]),
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
