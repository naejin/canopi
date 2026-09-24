import { describe, expect, it } from 'vitest'
import type { LidarAnalysisSummary, LidarLayerSummary, LidarLibrarySnapshot } from '../generated/contracts'
import { filterLibraryItems, libraryItems, suggestedItemName } from '../app/lidar/library-items'

function layer(id: string, name: string, overrides: Partial<LidarLayerSummary> = {}): LidarLayerSummary {
  return {
    id, name,
    generation_id: `${id}-g1`,
    measurement_kind: 'GroundElevation',
    units: 'm',
    state: 'Ready',
    resolution_m: 1,
    coverage_cells: null,
    bounds: [0, 0, 1, 1],
    value_range: [10, 20],
    display_range: null,
    tilesets: [],
    analysis_count: 0,
    import_job: null,
    ...overrides,
  }
}

function slope(id: string, source: string, overrides: Partial<LidarAnalysisSummary> = {}): LidarAnalysisSummary {
  return {
    id,
    generation_id: `${id}-g1`,
    input_generation_id: `${source}-g1`,
    source_layer_id: source,
    kind: 'Slope',
    name: null,
    state: 'Ready',
    detail: null,
    bounds: [0, 0, 1, 1],
    value_range: [0, 40],
    slope_unit: 'Degrees',
    tilesets: [],
    ...overrides,
  } as LidarAnalysisSummary
}

function snapshot(layers: LidarLayerSummary[], analyses: LidarAnalysisSummary[] = []): LidarLibrarySnapshot {
  return { layers, analyses, engine: { available: true, version: '3.8.4', detail: null } }
}

describe('Data Library items', () => {
  it('lists sources and saved results together in a stable name order', () => {
    const items = libraryItems(snapshot(
      [layer('b', 'terrain'), layer('a', 'Terrain'), layer('c', 'Canopy')],
      [slope('s', 'c')],
    ), 'Slope')

    expect(items.map((item) => item.id)).toEqual(['c', 's', 'a', 'b'])
    expect(items[1]).toMatchObject({ kind: 'Analysis', name: 'Canopy · Slope', units: '°', sourceLayerId: 'c', inputGenerationId: 'c-g1' })
  })

  it('shows an unpublished import as preparing while it runs and failed after', () => {
    const job = { job_id: 'j', layer_id: 'x', message: 'bad file', progress: null }
    const [running] = libraryItems(snapshot([layer('x', 'X', { generation_id: null, import_job: { ...job, state: 'Staging' } })]))
    const [failed] = libraryItems(snapshot([layer('x', 'X', { generation_id: null, import_job: { ...job, state: 'Failed' } })]))

    expect(running).toMatchObject({ status: 'preparing', importJob: { state: 'Staging' } })
    expect(failed).toMatchObject({ status: 'failed', message: 'bad file' })
  })

  it('keeps unsettled imports visible whatever the search and filter', () => {
    const items = libraryItems(snapshot(
      [layer('a', 'Ground'), layer('x', 'Pending', { generation_id: null, import_job: { job_id: 'j', layer_id: 'x', state: 'Applying', message: null, progress: null } })],
      [slope('s', 'a')],
    ))

    expect(filterLibraryItems(items, 'ground', 'slope').map((item) => item.id)).toEqual(['s', 'x'])
    expect(filterLibraryItems(items, 'zzz', 'all').map((item) => item.id)).toEqual(['x'])
    expect(filterLibraryItems(items, '', 'sources').map((item) => item.id)).toEqual(['a', 'x'])
  })

  it('narrows to the saved results of one source', () => {
    const items = libraryItems(snapshot([layer('a', 'A'), layer('b', 'B')], [slope('s1', 'a'), slope('s2', 'b')]))
    expect(filterLibraryItems(items, '', 'all', 'a').map((item) => item.id)).toEqual(['s1'])
  })

  it('suggests a name from the shared stem of the chosen files', () => {
    expect(suggestedItemName(['/d/LHD_FXX_0712_6250.tif', '/d/LHD_FXX_0712_6251.tif'])).toBe('LHD_FXX_0712_625')
    expect(suggestedItemName(['C:\\d\\mnt.asc'])).toBe('mnt')
    expect(suggestedItemName(['/a/north.tif', '/a/south.tif'])).toBe('north')
    expect(suggestedItemName([])).toBe('')
  })
})
